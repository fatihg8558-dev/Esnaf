import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  Account,
  BusinessProfile,
  CheckNote,
  CheckNoteStatus,
  CurrencyCode,
  ExpenseCategory,
  GibCredential,
  Invoice,
  InvoiceLineItem,
  SavedItem,
  Transaction,
} from '../types';
import { sanitizeString } from '../utils/formatters';

function getTimeSortValue(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as any).toMillis === 'function') {
    return (ts as any).toMillis();
  }
  if (typeof ts === 'number') return ts;
  return 0;
}

function currencyFieldFor(currency: CurrencyCode): 'usdBalance' | 'eurBalance' | 'gbpBalance' | null {
  if (currency === 'USD') return 'usdBalance';
  if (currency === 'EUR') return 'eurBalance';
  if (currency === 'GBP') return 'gbpBalance';
  return null;
}

// 1. Business Profile
export function subscribeBusinessProfile(
  uid: string,
  onData: (profile: BusinessProfile | null) => void
): Unsubscribe {
  const path = `businessProfiles/${uid}`;
  return onSnapshot(
    doc(db, 'businessProfiles', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
      } else {
        onData({ id: snap.id, ...(snap.data() as Omit<BusinessProfile, 'id'>) });
      }
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export async function saveBusinessProfile(
  uid: string,
  input: Omit<BusinessProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `businessProfiles/${uid}`;
  const ref = doc(db, 'businessProfiles', uid);
  const payload = {
    title: sanitizeString(input.title, 160) || 'Esnaf İşletmem',
    taxId: sanitizeString(input.taxId.replace(/\D/g, ''), 11),
    taxOffice: sanitizeString(input.taxOffice, 100),
    address: sanitizeString(input.address, 300),
    city: sanitizeString(input.city, 60),
    district: sanitizeString(input.district, 60),
    phone: sanitizeString(input.phone, 24),
    email: sanitizeString(input.email, 120),
    iban: sanitizeString(input.iban, 40).toUpperCase(),
    defaultInvoiceNote: sanitizeString(input.defaultInvoiceNote, 300),
    defaultGibMode: 'live' as const,
  };

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// 1b. Şifrelenmiş GİB Kimlik Bilgileri
export function subscribeGibCredential(
  uid: string,
  onData: (cred: GibCredential | null) => void
): Unsubscribe {
  const path = `gibCredentials/${uid}`;
  return onSnapshot(
    doc(db, 'gibCredentials', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
      } else {
        onData({ id: snap.id, ...(snap.data() as Omit<GibCredential, 'id'>) });
      }
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export async function saveGibCredential(
  uid: string,
  input: Pick<GibCredential, 'userCode' | 'encryptedSecret' | 'mode' | 'autoConnect'>
): Promise<void> {
  const path = `gibCredentials/${uid}`;
  const ref = doc(db, 'gibCredentials', uid);
  const payload = {
    userCode: sanitizeString(input.userCode, 40),
    encryptedSecret: sanitizeString(input.encryptedSecret, 512),
    mode: 'live' as const,
    autoConnect: Boolean(input.autoConnect),
  };

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateGibAutoConnect(uid: string, autoConnect: boolean): Promise<void> {
  const path = `gibCredentials/${uid}`;
  const ref = doc(db, 'gibCredentials', uid);
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) return;
    await updateDoc(ref, {
      mode: 'live',
      autoConnect: Boolean(autoConnect),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteGibCredential(uid: string): Promise<void> {
  const path = `gibCredentials/${uid}`;
  try {
    await deleteDoc(doc(db, 'gibCredentials', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 2. Cari Hesaplar (Accounts)
export function subscribeAccounts(uid: string, onData: (items: Account[]) => void): Unsubscribe {
  const path = 'accounts';
  const q = query(collection(db, 'accounts'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Account, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createAccount(
  uid: string,
  input: Omit<Account, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const path = `accounts/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const paymentTermDays = Math.min(3650, Math.max(0, Math.round(Number(input.paymentTermDays) || 0)));

  try {
    await setDoc(doc(db, 'accounts', id), {
      ownerId: uid,
      name: sanitizeString(input.name, 160),
      taxId: sanitizeString(input.taxId.replace(/\D/g, ''), 11),
      taxOffice: sanitizeString(input.taxOffice, 100),
      phone: sanitizeString(input.phone, 24),
      email: sanitizeString(input.email, 120),
      address: sanitizeString(input.address, 300),
      city: sanitizeString(input.city, 60),
      district: sanitizeString(input.district, 60),
      accountType: input.accountType,
      balance: Number(input.balance) || 0,
      currency,
      usdBalance: Number(input.usdBalance) || 0,
      eurBalance: Number(input.eurBalance) || 0,
      gbpBalance: Number(input.gbpBalance) || 0,
      nextDueDate: sanitizeString(input.nextDueDate, 20),
      paymentTermDays,
      notes: sanitizeString(input.notes, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAccount(
  id: string,
  input: Omit<
    Account,
    'id' | 'ownerId' | 'balance' | 'usdBalance' | 'eurBalance' | 'gbpBalance' | 'createdAt' | 'updatedAt'
  >
): Promise<void> {
  const path = `accounts/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const paymentTermDays = Math.min(3650, Math.max(0, Math.round(Number(input.paymentTermDays) || 0)));

  try {
    await updateDoc(doc(db, 'accounts', id), {
      name: sanitizeString(input.name, 160),
      taxId: sanitizeString(input.taxId.replace(/\D/g, ''), 11),
      taxOffice: sanitizeString(input.taxOffice, 100),
      phone: sanitizeString(input.phone, 24),
      email: sanitizeString(input.email, 120),
      address: sanitizeString(input.address, 300),
      city: sanitizeString(input.city, 60),
      district: sanitizeString(input.district, 60),
      accountType: input.accountType,
      currency,
      nextDueDate: sanitizeString(input.nextDueDate, 20),
      paymentTermDays,
      notes: sanitizeString(input.notes, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateAccountDueDate(id: string, nextDueDate: string): Promise<void> {
  const path = `accounts/${id}`;
  try {
    await updateDoc(doc(db, 'accounts', id), {
      nextDueDate: sanitizeString(nextDueDate, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAccount(id: string): Promise<void> {
  const path = `accounts/${id}`;
  try {
    await deleteDoc(doc(db, 'accounts', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 3. Gelir-Gider Hareketleri (Transactions)
export function subscribeTransactions(
  uid: string,
  onData: (items: Transaction[]) => void
): Unsubscribe {
  const path = 'transactions';
  const q = query(collection(db, 'transactions'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Transaction, 'id'>),
      }));
      list.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return getTimeSortValue(b.createdAt) - getTimeSortValue(a.createdAt);
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createTransaction(
  uid: string,
  input: Omit<Transaction, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  options?: { nextDueDate?: string }
): Promise<string> {
  const id = crypto.randomUUID();
  const path = `transactions/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const exchangeRate = currency === 'TRY' ? 1 : Math.max(0.0001, Number(input.exchangeRate) || 1);
  const originalAmount = Math.abs(Number(input.originalAmount ?? input.amount) || 0);
  const amount = Math.abs(
    Number(input.amount) || Math.round(originalAmount * exchangeRate * 100) / 100
  );

  if (amount <= 0 || originalAmount <= 0) {
    throw new Error('İşlem tutarı sıfırdan büyük olmalıdır.');
  }

  const entryKind = input.entryKind || 'ledger';

  try {
    const batch = writeBatch(db);
    const txRef = doc(db, 'transactions', id);
    batch.set(txRef, {
      ownerId: uid,
      type: input.type,
      category: sanitizeString(input.category, 80) || 'Genel',
      amount,
      currency,
      originalAmount,
      exchangeRate,
      entryKind,
      vatRate: Number(input.vatRate) || 0,
      description: sanitizeString(input.description, 300),
      date: sanitizeString(input.date, 20),
      paymentMethod: input.paymentMethod,
      accountId: sanitizeString(input.accountId, 128),
      accountName: sanitizeString(input.accountName, 160),
      invoiceId: sanitizeString(input.invoiceId, 128),
      affectsBalance: Boolean(input.affectsBalance),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (input.accountId && input.affectsBalance) {
      const accRef = doc(db, 'accounts', input.accountId);
      // sale -> increases customer debt (+); expense (ödeme) -> reduces our supplier debt (+); income (tahsilat) -> reduces receivable (-)
      const sign = entryKind === 'sale' || input.type === 'expense' ? 1 : -1;
      const deltaTry = sign * amount;
      const deltaCurr = sign * originalAmount;
      const currField = currencyFieldFor(currency);

      const balanceUpdate: Record<string, unknown> = {
        balance: increment(deltaTry),
        updatedAt: serverTimestamp(),
      };
      if (currField) {
        balanceUpdate[currField] = increment(deltaCurr);
      }
      batch.update(accRef, balanceUpdate);
    }

    await batch.commit();

    if (input.accountId && options?.nextDueDate !== undefined) {
      await updateAccountDueDate(input.accountId, options.nextDueDate);
    }

    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTransaction(
  id: string,
  input: Pick<
    Transaction,
    | 'type'
    | 'category'
    | 'amount'
    | 'currency'
    | 'originalAmount'
    | 'exchangeRate'
    | 'entryKind'
    | 'vatRate'
    | 'description'
    | 'date'
    | 'paymentMethod'
    | 'accountId'
    | 'accountName'
  >
): Promise<void> {
  const path = `transactions/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const exchangeRate = currency === 'TRY' ? 1 : Math.max(0.0001, Number(input.exchangeRate) || 1);
  const originalAmount = Math.abs(Number(input.originalAmount ?? input.amount) || 0);
  const amount = Math.abs(Number(input.amount) || 0);
  if (amount <= 0 || originalAmount <= 0) {
    throw new Error('İşlem tutarı sıfırdan büyük olmalıdır.');
  }
  try {
    await updateDoc(doc(db, 'transactions', id), {
      type: input.type,
      category: sanitizeString(input.category, 80) || 'Genel',
      amount,
      currency,
      originalAmount,
      exchangeRate,
      entryKind: input.entryKind || 'ledger',
      vatRate: Number(input.vatRate) || 0,
      description: sanitizeString(input.description, 300),
      date: sanitizeString(input.date, 20),
      paymentMethod: input.paymentMethod,
      accountId: sanitizeString(input.accountId, 128),
      accountName: sanitizeString(input.accountName, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTransaction(tx: Transaction): Promise<void> {
  const path = `transactions/${tx.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'transactions', tx.id));
    if (tx.accountId && tx.affectsBalance) {
      const accRef = doc(db, 'accounts', tx.accountId);
      const accSnap = await getDoc(accRef);
      if (accSnap.exists()) {
        const sign = tx.entryKind === 'sale' || tx.type === 'expense' ? 1 : -1;
        const reverseTry = -sign * tx.amount;
        const origAmt = Number(tx.originalAmount ?? tx.amount) || tx.amount;
        const reverseCurr = -sign * origAmt;
        const currField = tx.currency ? currencyFieldFor(tx.currency) : null;

        const balanceUpdate: Record<string, unknown> = {
          balance: increment(reverseTry),
          updatedAt: serverTimestamp(),
        };
        if (currField) {
          balanceUpdate[currField] = increment(reverseCurr);
        }
        batch.update(accRef, balanceUpdate);
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 4. İsteğe Bağlı Kayıtlı Kalemler (SavedItems — Stok takibi yok)
export function subscribeSavedItems(uid: string, onData: (items: SavedItem[]) => void): Unsubscribe {
  const path = 'savedItems';
  const q = query(collection(db, 'savedItems'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SavedItem, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createSavedItem(
  uid: string,
  input: Omit<SavedItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const path = `savedItems/${id}`;
  try {
    await setDoc(doc(db, 'savedItems', id), {
      ownerId: uid,
      name: sanitizeString(input.name, 180),
      unit: sanitizeString(input.unit, 30) || 'Adet',
      unitPrice: Math.max(0, Number(input.unitPrice) || 0),
      vatRate: Math.max(0, Number(input.vatRate) || 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSavedItem(id: string): Promise<void> {
  const path = `savedItems/${id}`;
  try {
    await deleteDoc(doc(db, 'savedItems', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 5. e-Arşiv Fatura Arşivi (Invoices)
export function subscribeInvoices(uid: string, onData: (items: Invoice[]) => void): Unsubscribe {
  const path = 'invoices';
  const q = query(collection(db, 'invoices'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Invoice, 'id'>),
      }));
      list.sort((a, b) => {
        if (a.invoiceDate !== b.invoiceDate) return b.invoiceDate.localeCompare(a.invoiceDate);
        return getTimeSortValue(b.createdAt) - getTimeSortValue(a.createdAt);
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

function sanitizeInvoiceItems(items: InvoiceLineItem[]): InvoiceLineItem[] {
  return items.slice(0, 50).map((item) => ({
    id: sanitizeString(item.id, 64) || crypto.randomUUID(),
    name: sanitizeString(item.name, 180) || 'Hizmet',
    quantity: Math.max(0.001, Number(item.quantity) || 1),
    unit: sanitizeString(item.unit, 30) || 'Adet',
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    vatRate: Math.max(0, Number(item.vatRate) || 0),
    lineSubtotal: Math.max(0, Number(item.lineSubtotal) || 0),
    lineVat: Math.max(0, Number(item.lineVat) || 0),
    lineTotal: Math.max(0, Number(item.lineTotal) || 0),
  }));
}

export async function createDraftInvoice(
  uid: string,
  input: Omit<Invoice, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const path = `invoices/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const exchangeRate = currency === 'TRY' ? 1 : Math.max(0.0001, Number(input.exchangeRate) || 1);

  try {
    await setDoc(doc(db, 'invoices', id), {
      ownerId: uid,
      ettn: sanitizeString(input.ettn, 64),
      invoiceNo: sanitizeString(input.invoiceNo, 40),
      invoiceDate: sanitizeString(input.invoiceDate, 20),
      invoiceTime: sanitizeString(input.invoiceTime, 12),
      invoiceType: input.invoiceType,
      gibMode: input.gibMode,
      status: 'draft',
      currency,
      exchangeRate,
      sellerTitle: sanitizeString(input.sellerTitle, 160),
      sellerTaxId: sanitizeString(input.sellerTaxId, 11),
      sellerTaxOffice: sanitizeString(input.sellerTaxOffice, 100),
      sellerAddress: sanitizeString(input.sellerAddress, 300),
      recipientAccountId: sanitizeString(input.recipientAccountId, 128),
      recipientName: sanitizeString(input.recipientName, 160),
      recipientTaxId: sanitizeString(input.recipientTaxId.replace(/\D/g, ''), 11),
      recipientTaxOffice: sanitizeString(input.recipientTaxOffice, 100),
      recipientAddress: sanitizeString(input.recipientAddress, 300),
      recipientCity: sanitizeString(input.recipientCity, 60),
      recipientDistrict: sanitizeString(input.recipientDistrict, 60),
      items: sanitizeInvoiceItems(input.items),
      subtotal: Math.max(0, Number(input.subtotal) || 0),
      vatTotal: Math.max(0, Number(input.vatTotal) || 0),
      grandTotal: Math.max(0, Number(input.grandTotal) || 0),
      note: sanitizeString(input.note, 1000),
      smsApprovedAt: '',
      reflectedToLedger: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function approveInvoiceAndReflect(
  uid: string,
  invoice: Invoice,
  approvedInvoiceNo: string,
  approvedAt: string,
  options: {
    reflectToIncome: boolean;
    reflectToAccountBalance: boolean;
  }
): Promise<void> {
  const path = `invoices/${invoice.id}`;
  const currency: CurrencyCode = invoice.currency || 'TRY';
  const exchangeRate = currency === 'TRY' ? 1 : Math.max(0.0001, Number(invoice.exchangeRate) || 1);
  const tlTotal =
    currency === 'TRY'
      ? invoice.grandTotal
      : Math.round(invoice.grandTotal * exchangeRate * 100) / 100;

  try {
    const batch = writeBatch(db);
    const invRef = doc(db, 'invoices', invoice.id);
    const willReflect = options.reflectToIncome || options.reflectToAccountBalance;

    batch.update(invRef, {
      invoiceNo: sanitizeString(approvedInvoiceNo, 40) || invoice.invoiceNo,
      status: 'approved',
      smsApprovedAt: sanitizeString(approvedAt, 40),
      reflectedToLedger: willReflect,
      updatedAt: serverTimestamp(),
    });

    if (options.reflectToIncome && tlTotal > 0) {
      const txId = crypto.randomUUID();
      const txRef = doc(db, 'transactions', txId);
      const isReturn = invoice.invoiceType === 'IADE';
      batch.set(txRef, {
        ownerId: uid,
        type: isReturn ? 'expense' : 'income',
        category: isReturn ? 'Diğer Gider' : 'e-Arşiv Fatura Tahsilatı',
        amount: tlTotal,
        currency,
        originalAmount: invoice.grandTotal,
        exchangeRate,
        entryKind: 'ledger',
        vatRate: invoice.items[0]?.vatRate ?? 20,
        description: `${approvedInvoiceNo} no'lu e-Arşiv faturası (${invoice.recipientName})`.slice(0, 300),
        date: invoice.invoiceDate,
        paymentMethod: 'bank',
        accountId: sanitizeString(invoice.recipientAccountId, 128),
        accountName: sanitizeString(invoice.recipientName, 160),
        invoiceId: invoice.id,
        affectsBalance: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (options.reflectToAccountBalance && invoice.recipientAccountId && invoice.grandTotal > 0) {
      const accRef = doc(db, 'accounts', invoice.recipientAccountId);
      const accSnap = await getDoc(accRef);
      if (accSnap.exists()) {
        const sign = invoice.invoiceType === 'IADE' ? -1 : 1;
        const deltaTry = sign * tlTotal;
        const deltaCurr = sign * invoice.grandTotal;
        const currField = currencyFieldFor(currency);

        const balanceUpdate: Record<string, unknown> = {
          balance: increment(deltaTry),
          updatedAt: serverTimestamp(),
        };
        if (currField) {
          balanceUpdate[currField] = increment(deltaCurr);
        }
        batch.update(accRef, balanceUpdate);
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cancelInvoice(invoiceId: string): Promise<void> {
  const path = `invoices/${invoiceId}`;
  try {
    await updateDoc(doc(db, 'invoices', invoiceId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteInvoice(invoiceId: string): Promise<void> {
  const path = `invoices/${invoiceId}`;
  try {
    await deleteDoc(doc(db, 'invoices', invoiceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 6. Özel Gider Kalemleri (Expense Categories)
export function subscribeExpenseCategories(
  uid: string,
  onData: (items: ExpenseCategory[]) => void
): Unsubscribe {
  const path = 'expenseCategories';
  const q = query(collection(db, 'expenseCategories'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ExpenseCategory, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createExpenseCategory(uid: string, name: string): Promise<string> {
  const cleanName = sanitizeString(name, 80);
  if (!cleanName) {
    throw new Error('Gider kalemi adı boş olamaz.');
  }
  const id = crypto.randomUUID();
  const path = `expenseCategories/${id}`;
  try {
    await setDoc(doc(db, 'expenseCategories', id), {
      ownerId: uid,
      name: cleanName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteExpenseCategory(id: string): Promise<void> {
  const path = `expenseCategories/${id}`;
  try {
    await deleteDoc(doc(db, 'expenseCategories', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 7. Çek ve Senet Portföyü (Checks & Promissory Notes)
export function subscribeChecksNotes(
  uid: string,
  onData: (items: CheckNote[]) => void
): Unsubscribe {
  const path = 'checksNotes';
  const q = query(collection(db, 'checksNotes'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CheckNote, 'id'>),
      }));
      list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createCheckNote(
  uid: string,
  input: Omit<CheckNote, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const path = `checksNotes/${id}`;
  const currency: CurrencyCode = input.currency || 'TRY';
  const exchangeRate = currency === 'TRY' ? 1 : Math.max(0.0001, Number(input.exchangeRate) || 1);
  const amount = Math.abs(Number(input.amount) || 0);
  const amountTry =
    currency === 'TRY' ? amount : Math.round(amount * exchangeRate * 100) / 100;

  if (amount <= 0 || amountTry <= 0) {
    throw new Error('Çek/senet tutarı sıfırdan büyük olmalıdır.');
  }
  const bankOrIssuer = sanitizeString(input.bankOrIssuer, 160);
  if (!bankOrIssuer) {
    throw new Error('Banka veya keşideci bilgisi zorunludur.');
  }

  try {
    await setDoc(doc(db, 'checksNotes', id), {
      ownerId: uid,
      kind: input.kind,
      direction: input.direction,
      documentNo: sanitizeString(input.documentNo, 64),
      bankOrIssuer,
      accountId: sanitizeString(input.accountId, 128),
      accountName: sanitizeString(input.accountName, 160),
      amount,
      currency,
      exchangeRate,
      amountTry,
      issueDate: sanitizeString(input.issueDate, 20),
      dueDate: sanitizeString(input.dueDate, 20),
      status: input.status || 'pending',
      notes: sanitizeString(input.notes, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCheckNoteStatus(
  id: string,
  status: CheckNoteStatus
): Promise<void> {
  const path = `checksNotes/${id}`;
  try {
    await updateDoc(doc(db, 'checksNotes', id), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCheckNote(id: string): Promise<void> {
  const path = `checksNotes/${id}`;
  try {
    await deleteDoc(doc(db, 'checksNotes', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

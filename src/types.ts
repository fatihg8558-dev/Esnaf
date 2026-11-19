export type GibMode = 'live' | 'test';
export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP';
export type AccountType = 'customer' | 'supplier' | 'both';
export type TransactionType = 'income' | 'expense';
export type TransactionEntryKind = 'ledger' | 'sale' | 'collection' | 'payment' | 'check_note';
export type PaymentMethod = 'cash' | 'bank' | 'pos' | 'transfer';
export type InvoiceStatus = 'draft' | 'approved' | 'cancelled';
export type InvoiceType = 'SATIS' | 'IADE';
export type CheckNoteKind = 'cek' | 'senet';
export type CheckNoteDirection = 'receivable' | 'payable';
export type CheckNoteStatus = 'pending' | 'collected' | 'paid' | 'bounced';

export interface BusinessProfile {
  id: string;
  ownerId: string;
  title: string;
  taxId: string;
  taxOffice: string;
  address: string;
  city: string;
  district: string;
  phone: string;
  email: string;
  iban?: string;
  defaultInvoiceNote?: string;
  defaultGibMode: GibMode;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Account {
  id: string;
  ownerId: string;
  name: string;
  taxId: string;
  taxOffice: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  district: string;
  accountType: AccountType;
  balance: number; // +: müşteri bize borçlu (alacaklıyız), -: tedarikçiye borçluyuz (TL)
  currency?: CurrencyCode;
  usdBalance?: number;
  eurBalance?: number;
  gbpBalance?: number;
  nextDueDate?: string; // YYYY-MM-DD
  paymentTermDays?: number;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Transaction {
  id: string;
  ownerId: string;
  type: TransactionType;
  category: string;
  amount: number; // TL karşılığı
  currency?: CurrencyCode;
  originalAmount?: number;
  exchangeRate?: number;
  entryKind?: TransactionEntryKind;
  vatRate: number;
  description: string;
  date: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  accountId: string;
  accountName: string;
  invoiceId: string;
  affectsBalance: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SavedItem {
  id: string;
  ownerId: string;
  name: string;
  unit: string;
  unitPrice: number;
  vatRate: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExpenseCategory {
  id: string;
  ownerId: string;
  name: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CheckNote {
  id: string;
  ownerId: string;
  kind: CheckNoteKind;
  direction: CheckNoteDirection;
  documentNo: string;
  bankOrIssuer: string;
  accountId: string;
  accountName: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRate: number;
  amountTry: number;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  status: CheckNoteStatus;
  notes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InvoiceLineItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
  saveToQuickList?: boolean;
}

export interface Invoice {
  id: string;
  ownerId: string;
  ettn: string;
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceTime: string; // HH:mm:ss
  invoiceType: InvoiceType;
  gibMode: GibMode;
  status: InvoiceStatus;
  currency?: CurrencyCode;
  exchangeRate?: number;
  sellerTitle: string;
  sellerTaxId: string;
  sellerTaxOffice: string;
  sellerAddress: string;
  recipientAccountId: string;
  recipientName: string;
  recipientTaxId: string;
  recipientTaxOffice: string;
  recipientAddress: string;
  recipientCity: string;
  recipientDistrict: string;
  items: InvoiceLineItem[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  note: string;
  smsApprovedAt: string;
  reflectedToLedger: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GibSessionState {
  connected: boolean;
  sessionId: string | null;
  mode: GibMode;
  userCode: string;
  sellerInfo?: {
    title: string;
    taxId: string;
    taxOffice: string;
    address: string;
    city: string;
    district: string;
  };
}

export interface DvSessionState {
  connected: boolean;
  dvSessionId: string | null;
  userCode: string;
}

export interface GibCredential {
  id: string;
  ownerId: string;
  userCode: string;
  encryptedSecret: string;
  mode: GibMode;
  autoConnect: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReceivedInvoice {
  id: string;
  ownerId: string;
  ettn: string;
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceType: string;
  sellerName: string;
  sellerTaxId: string;
  currency: CurrencyCode;
  exchangeRate: number;
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  approvalStatus: string;
  reflectedToExpense: boolean;
  linkedTransactionId: string;
  linkedAccountId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ETebligatItem {
  id: string;
  ownerId: string;
  tebligatId: string;
  tarafId?: string;
  tarafSecureId?: string;
  tebligId?: string;
  tebligSecureId?: string;
  subject: string;
  senderUnit: string;
  documentNo: string;
  sentDate: string; // YYYY-MM-DD
  legalServedDate: string; // YYYY-MM-DD (+5 days)
  isRead: boolean;
  readAt: string;
  notes: string;
  source: 'live' | 'manual';
  portalUrl?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ActiveTab =
  | 'dashboard'
  | 'ledger'
  | 'accounts'
  | 'invoice'
  | 'archive'
  | 'received'
  | 'etebligat'
  | 'settings';

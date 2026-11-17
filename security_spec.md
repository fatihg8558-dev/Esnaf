# Firestore Güvenlik Kuralları Spesifikasyonu (Security TDD)

## 1. Veri Değişmezleri (Data Invariants)
1. **Sahiplik İzolasyonu**: `businessProfiles`, `accounts`, `transactions`, `savedItems` ve `invoices` koleksiyonlarındaki her belgenin `ownerId` alanı `request.auth.uid` ile birebir eşleşmelidir. Doğrulanmamış e-posta (`email_verified != true`) yazma veya okuma yapamaz.
2. **Belge Kimliği & Boyut Sınırı**: Tüm belge ID'leri `^[a-zA-Z0-9_\-]+$` regex kuralına uymalı ve 128 karakteri aşmamalıdır. Tüm metin alanları açık `maxLength` sınırına tabidir.
3. **Değişmez Alanlar & Sunucu Zamanı**: `ownerId` ve `createdAt` alanları oluşturulduktan sonra değiştirilemez. Oluşturmada `createdAt == request.time && updatedAt == request.time`, güncellemede `updatedAt == request.time` zorunludur.
4. **Fatura Kalem Dizisi Sınırı**: `invoices.items` dizisi en az 1, en fazla 50 kalem içerebilir ve ilk elemanı geçerli bir harita (`name` string, `<= 180` karakter) olmalıdır.
5. **Durum Kilidi**: `cancelled` durumuna geçmiş faturalar tekrar güncellenemez. Canlı (`live`) ve onaylı (`approved`) faturalar doğrudan silinemez, yalnızca iptal edilebilir.
6. **Sorgu Güvenliği**: Tüm `list` sorguları kural düzeyinde `resource.data.ownerId == request.auth.uid` şartını zorunlu kılar.

## 2. "Dirty Dozen" Saldırı Senaryoları (PERMISSION_DENIED Beklenenler)
1. **Kimlik Sahteciliği (Create)**: Başka bir kullanıcının `uid` değeri (`ownerId: "victim-uid"`) ile cari veya gelir-gider kaydı oluşturma.
2. **E-posta Doğrulamasız Erişim**: `email_verified: false` olan token ile okuma/yazma denemesi.
3. **Gölge Alan Enjeksiyonu (Shadow Field)**: Geçerli `Account` yüküne ekstra `isAdmin: true` veya `verified: true` alanı ekleme.
4. **Tip Zehirlenmesi (Value Poisoning)**: `amount` veya `balance` alanına string gönderme ya da `items` listesini boş `[]` gönderme.
5. **1MB Kaynak Tüketimi (ID Poisoning)**: 500 karakterlik veya özel karakterli belge kimliğiyle belge oluşturma.
6. **Zaman Damgası Sahteciliği**: `createdAt` alanına sunucu zamanı yerine geçmiş/gelecek tarih gönderme.
7. **Sahiplik Devri (Update)**: Mevcut bir kayıtta `ownerId` veya `createdAt` alanını güncelleme.
8. **Yetkisiz Toplu Listeleme (Blanket List)**: `where('ownerId', '==', uid)` filtresi olmadan `accounts` veya `invoices` koleksiyonunu listeleme.
9. **PII Sızıntısı**: Başka kullanıcının `businessProfiles/{otherUid}` belgesini `get` ile okuma.
10. **İptal Edilmiş Faturayı Değiştirme**: `status: "cancelled"` olan bir faturayı tekrar `"approved"` durumuna çekme.
11. **Onaylı Canlı Faturayı Silme**: `gibMode: "live"` ve `status: "approved"` olan faturayı `delete` etme.
12. **Aşırı Büyük Kalem Listesi**: `invoices.items` dizisine 51 öğe göndererek belge sınırı istismarı denemesi.

# ScanDesk

Barkod tarama ve envanter yönetim uygulaması. Gerçek zamanlı barkod okuma, çoklu kullanıcı desteği, müşteri/ürün yönetimi ve veri dışa aktarma özellikleri sunar.

## Özellikler

- 📷 **Gerçek zamanlı barkod tarama** — Cihaz kamerası veya QR okuyucu ile
- 👥 **Çoklu kullanıcı** — Admin ve kullanıcı rolleri
- 🏢 **Müşteri yönetimi** — Özel veri alanları ile
- ⏰ **Vardiya takibi** — Envanter operasyonları için
- 📊 **Excel/CSV dışa aktarma**
- ☁️ **Bulut entegrasyonu** — Supabase (PostgreSQL) ve Google Sheets
- 📱 **Mobil uyumlu** — Responsive web + Android (Capacitor)

## Teknolojiler

| Kategori | Teknoloji |
|----------|-----------|
| Frontend | React 18 |
| Build | Vite 6 |
| Mobil | Capacitor 7 (Android) |
| Barkod | ZXing Browser |
| Dışa Aktarma | XLSX |

## Başlangıç

```bash
cd scandesk-project
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

## Android APK

### APK İndirme

Hazır APK dosyasını GitHub Actions üzerinden indirebilirsiniz:

1. Depo sayfasında **Actions** sekmesine gidin
2. En son başarılı **Build APK** çalışmasını seçin
3. Sayfanın altındaki **Artifacts** bölümünden **ScanDesk-APK** dosyasını indirin
4. İndirilen ZIP dosyasını açın ve `app-debug.apk` dosyasını Android cihazınıza yükleyin

### Yerel APK Derleme

Alternatif olarak kendi bilgisayarınızda APK derleyebilirsiniz:

```bash
bash build.sh
```

## Proje Yapısı

```
src/
├── components/        # UI bileşenleri
│   ├── ScanPage.jsx   # Barkod tarama sayfası
│   ├── DataPage.jsx   # Veri görüntüleme/yönetim
│   ├── UsersPage.jsx  # Kullanıcı yönetimi
│   ├── SettingsPage.jsx # Uygulama ayarları
│   ├── FieldsPage.jsx # Özel alan yönetimi
│   ├── Login.jsx      # Giriş ekranı
│   ├── ErrorBoundary.jsx # Hata yakalama
│   └── ...            # Diğer bileşenler
├── services/          # İş mantığı servisleri
│   ├── storage.js     # Veri kalıcılığı
│   └── integrations.js # Supabase & Sheets
├── hooks/             # Özel React hook'ları
│   └── useToast.js    # Bildirim sistemi
├── constants.js       # Sabitler ve başlangıç durumu
├── utils.js           # Yardımcı fonksiyonlar
├── index.css          # Uygulama stilleri
├── App.jsx            # Ana uygulama bileşeni
└── main.jsx           # Giriş noktası
```

## Varsayılan Giriş

- **Kullanıcı:** `admin`
- **Şifre:** `admin123`

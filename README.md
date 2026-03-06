# ScanDesk

**ScanDesk**, barkod okuma ve kayıt yönetimi için geliştirilmiş bir web/Android uygulamasıdır. React + Vite ile oluşturulmuş, Capacitor aracılığıyla Android APK olarak da dağıtılabilir.

---

## Proje Yapısı

```
scandesk/
└── scandesk-project/          # Ana proje klasörü
    ├── src/                   # Kaynak kodlar (React bileşenleri)
    │   ├── main.jsx           # React uygulama giriş noktası
    │   └── App.jsx            # Tüm uygulama mantığı ve bileşenler
    ├── android/               # Capacitor tarafından oluşturulan Android projesi
    │   └── app/src/main/
    │       └── java/com/scandesk/app/
    │           └── MainActivity.java
    ├── index.html             # HTML giriş dosyası
    ├── package.json           # npm bağımlılıkları ve betikler
    ├── vite.config.js         # Vite yapılandırması
    ├── capacitor.config.json  # Capacitor (Android) yapılandırması
    └── build.sh               # APK üretim betiği
```

---

## Teknoloji Yığını

| Araç / Kütüphane | Amaç |
|---|---|
| [React 18](https://react.dev/) | UI bileşen kütüphanesi |
| [Vite](https://vite.dev/) | Geliştirme sunucusu ve build aracı |
| [Capacitor](https://capacitorjs.com/) | Web uygulamasını Android APK'ya dönüştürme |
| [@zxing/browser](https://github.com/zxing-js/browser) | Kamera ile barkod okuma |
| [xlsx](https://github.com/SheetJS/sheetjs) | Excel (XLSX) ve CSV dosyası oluşturma |
| [@capacitor/preferences](https://capacitorjs.com/docs/apis/preferences) | Android'de kalıcı depolama |
| [@capacitor/filesystem](https://capacitorjs.com/docs/apis/filesystem) | Android'de dosya sistemi erişimi |
| [@capacitor/share](https://capacitorjs.com/docs/apis/share) | Android paylaşım diyaloğu |

---

## `src/` Klasörü — Ana Dosyalar

### `src/main.jsx`

React uygulamasının **giriş noktasıdır**. `index.html` içindeki `#root` div'ine React ağacını bağlar.

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

---

### `src/App.jsx`

Uygulamanın **tamamı** bu tek dosyada yer alır (~1800 satır). Aşağıdaki bölümlere ayrılmıştır:

#### 1. Sabitler ve Başlangıç Durumu

| Sabit | Açıklama |
|---|---|
| `INITIAL_USERS` | Varsayılan `admin` kullanıcısı |
| `INITIAL_SETTINGS` | Vardiya listesi, ses, titreşim, kamera vb. ayarlar |
| `INITIAL_FIELDS` | Varsayılan kayıt alanları: Barkod, Miktar, Not |
| `FIELD_TYPES` | Desteklenen alan tipleri: Metin, Sayı, Tarih, Onay Kutusu |
| `DEFAULT_CUSTS` | Örnek müşteri listesi |

#### 2. Yardımcı Fonksiyonlar

| Fonksiyon | Açıklama |
|---|---|
| `genId()` | Benzersiz ID üretir (`crypto.randomUUID` veya fallback) |
| `fmtDate(ts)` | ISO zaman damgasını `YYYY-MM-DD` formatına çevirir |
| `fmtTime(ts)` | ISO zaman damgasını `HH:MM` formatına çevirir |
| `getDefaultShift(list)` | Günün saatine göre varsayılan vardiyayı seçer |

#### 3. Kalıcı Depolama

Uygulama verisi platform farkı gözetilerek kaydedilir:
- **Android (Capacitor):** `@capacitor/preferences` kullanılır.
- **Web:** `localStorage` kullanılır.

| Fonksiyon | Açıklama |
|---|---|
| `loadState()` | Kaydedilmiş durumu yükler |
| `saveState(state)` | Mevcut durumu kaydeder |

#### 4. Entegrasyon Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `supabaseInsert(cfg, row)` | Barkod kaydını Supabase tablosuna gönderir |
| `sheetsInsert(cfg, headers, row)` | Barkod kaydını Google Sheets Apps Script'e gönderir |

#### 5. Stil (CSS)

`CSS` sabitinde tüm uygulama stilleri tanımlanır (CSS-in-JS yaklaşımı). Koyu tema, responsive tasarım (mobil alt navigasyon + masaüstü yan menü), animasyonlar ve bileşen stilleri burada yer alır.

#### 6. React Bileşenleri

| Bileşen | Açıklama |
|---|---|
| `Ic` | SVG ikon bileşeni; `I` nesnesindeki path verileriyle ikon çizer |
| `Toggle` | Açma/kapama düğmesi (iOS tarzı) |
| `PasswordInput` | Şifre alanı; göster/gizle butonu içerir |
| `Login` | Giriş ekranı; kullanıcı adı + şifre doğrulama |
| `CustomerModal` | Müşteri seçme/ekleme/silme modal penceresi |
| `EditRecordModal` | Mevcut barkod kaydını düzenleme modal penceresi |

#### 7. Sayfa Bileşenleri

| Bileşen | Navigasyon Etiketi | Açıklama |
|---|---|---|
| `ScanPage` | **Tara** | Kamera veya manuel girişle barkod okuma, kayıt oluşturma, ek alan doldurma |
| `DataPage` | **Veriler** | Kayıtları listeleme, arama, müşteriye göre gruplama, XLSX/CSV dışa aktarma, kayıt silme/düzenleme |
| `FieldsPage` | **Alanlar** | Özel kayıt alanlarını ekleme, düzenleme, silme, sıralama |
| `UsersPage` | **Kullanıcı** *(sadece admin)* | Kullanıcı ekleme, düzenleme, silme, şifre değiştirme |
| `SettingsPage` | **Ayarlar** | Vardiya, barkod kutusu, ses/titreşim, entegrasyon (Supabase/Google Sheets), veri temizleme |

#### 8. Kök Bileşen (`App`)

`App` bileşeni uygulamanın tüm durumunu yönetir:

- **Kullanıcı oturumu** — giriş/çıkış
- **Kayıtlar** — ekleme, düzenleme, silme, tarih aralığı silme, dışa aktarma
- **Müşteri listesi** — ekleme/silme
- **Ayarlar** — kalıcı depolama ile senkronizasyon
- **Navigasyon** — `scan | data | fields | users | settings` sayfa yönlendirmesi
- **Toast bildirimleri** — işlem sonuçlarını kısa süreli gösterir
- **Responsive düzen** — mobilde alt navigasyon çubuğu, masaüstünde sol kenar çubuğu

---

## Kurulum ve Çalıştırma

### Gereksinimler

- Node.js 18+
- (Android APK için) Android Studio, Java 17+

### Geliştirme Sunucusu

```bash
cd scandesk-project
npm install
npm run dev
```

### Web Build

```bash
npm run build
```

### Android APK Üretimi

```bash
bash build.sh
```

Betik sırasıyla şu adımları gerçekleştirir:
1. `npm ci` — bağımlılıkları kurar
2. `npm run build` — Vite ile web build alır
3. `npx cap add android` *(ilk kurulumda)* veya `npx cap sync android`
4. `./gradlew assembleDebug` — debug APK üretir

Çıktı: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Uygulama Özellikleri

- 📷 **Kamera ile barkod okuma** — `@zxing/browser` (ön/arka kamera seçimi)
- ⌨️ **Manuel barkod girişi** — harici barkod okuyucu veya klavye ile
- 👥 **Çok kullanıcılı sistem** — rol tabanlı erişim (admin / kullanıcı)
- 🗂️ **Özelleştirilebilir alanlar** — her kayıda ek veri alanı eklenebilir
- 🏢 **Müşteri bazlı gruplama** — kayıtlar müşterilere göre organize edilir
- 📊 **Dışa aktarma** — XLSX ve CSV formatları desteklenir
- ☁️ **Bulut entegrasyonu** — Supabase veya Google Sheets'e anlık gönderim
- 💾 **Çevrimdışı çalışma** — veriler cihazda saklanır (Preferences / localStorage)
- 📱 **Android desteği** — Capacitor ile native APK olarak dağıtılabilir

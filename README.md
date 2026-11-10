# DynamicChart · Grafik Atölyesi

SQL Server verilerini sütun, çizgi ve radar grafiklerine dönüştüren Türkçe, responsive çalışma alanı. HTML, CSS, vanilla JavaScript ve sürümü sabitlenmiş Chart.js kullanır; derleme gerekmez. jQuery ve Bootstrap bağımlılıkları kaldırılmıştır.

## Çalıştırma

Repo kökünde `python3 -m http.server 8080 --bind 0.0.0.0` çalıştırıp `http://localhost:8080` adresini açın. Alternatif olarak herhangi bir statik web sunucusu kullanabilirsiniz. Node yalnızca geliştirme testleri içindir; yayınlamada `index.html`, `css/` ve `js/` yeterlidir.

**Örnek veriyi dene** ile veritabanı/API gerektirmeden 12 aylık örnek satış ve gider verisini keşfedebilirsiniz. Örnek mod açıkça işaretlenir ve hiçbir ağ isteği göndermez.

## API bağlantısı

Arayüz, [DynamicChartCase API](https://github.com/bayansalduza/DynamicChartCase) sözleşmesini değiştirmeden kullanır:

| İşlem | POST adresi | Gövde |
| --- | --- | --- |
| Bağlantı testi | `/api/Connection/TestConnection` | `{ ServerName, DatabaseName, UserName, Password }` |
| Kaynak listesi | `/api/Metadata/GetDataSources` | Aynı bağlantı bilgileri |
| Veri yükleme | `/api/ChartData/GetData` | `{ connectionParameters, dataSourceName, objectType, parameters: {} }` |

Varsayılan API adresi mevcut IIS Express adresi olan `https://localhost:44344` olarak korunmuştur. **API bağlantı ayarları** bölümünden değiştirilebilir; yayın ortamının varsayılanı `index.html` içindeki `api-base-url` meta alanından ayarlanır. API projesinin diğer yerel profilleri `http://localhost:5292` ve `https://localhost:7116` adreslerini kullanır. Uzak API için HTTPS zorunludur; yalnızca localhost üzerinde HTTP kullanılabilir. Tarayıcının API sertifikasına güvenmesi ve API’nin frontend origin’ine CORS izni vermesi gerekir.

Kimlik bilgileri yalnızca formda ve sayfanın belleğinde tutulur, seçilen API’ye gönderilir; localStorage, sessionStorage, çerez veya URL’ye yazılmaz. Bağlantı alanları değişince eski bağlantı, veri ve bekleyen istekler geçersiz kılınır. Gerçek veritabanı için API’nin erişebildiği SQL Server ve yetkili kullanıcı gerekir.

API’de parametre metadata’sı bulunmadığından parametre gerektiren stored procedure/fonksiyonlar desteklenmez. Parametresiz kaynaklarda mevcut API davranışı korunur.

## Görselleştirme ve indirme

- Bağlantı başarılıysa kaynaklar otomatik listelenir; **Yenile** ile tekrar alınabilir.
- Etiket ve sayısal değer kolonları otomatik önerilir; karışık metin içeren kolonlar değer kolonu olarak sunulmaz. Null değerler sıfıra dönüştürülmez.
- Grafik okunabilirlik için ilk **100 kaydı** gösterir ve bu sınırı bildirir. Özet toplamı, arama, 8 satırlık tablo sayfalaması ve CSV tüm yüklenen kayıtları kullanır. Tekrarlanan etiketler otomatik gruplanmaz.
- CSV, Türkçe Excel uyumu için UTF-8 BOM ve noktalı virgül ayırıcı kullanır; formül olabilecek metinler güvenli hale getirilir. Arama yalnızca tabloyu filtreler; CSV her zaman tüm kayıtları içerir.
- PNG beyaz arka planlı grafiği indirir. Chart.js CDN üzerinden yüklenir; erişilemezse tablo/CSV çalışmaya devam eder ve grafik alanı hata mesajı gösterir.
- Grafik/veri sekmeleri ok tuşları, Home ve End ile kullanılabilir. Azaltılmış hareket tercihi desteklenir.

## Kontroller

Node.js 20+ ile:

```sh
npm install
npm run check
npm test
```

Node test runner + jsdom testleri API gövdelerini, yarışan istekleri, bağlantı değişikliklerini, veri tiplerini, boş/hata durumlarını, tabloyu ve güvenli dışa aktarmayı doğrular. CI aynı kontrolleri çalıştırır. Bunlar gerçek SQL Server entegrasyonu veya tarayıcı görsel testinin yerine geçmez.

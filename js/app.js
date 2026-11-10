(() => {
  "use strict";

  const formatNumber = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
  const PAGE_SIZE = 8;
  const CHART_LIMIT = 100;

  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function describeRecords(records) {
    const columns = [...new Set(records.flatMap(row => Object.keys(row)))];
    const numericColumns = columns.filter(column => {
      let hasNumber = false;
      for (const row of records) {
        const value = row[column];
        if (value === null || value === undefined || value === "") continue;
        if (numericValue(value) === null) return false;
        hasNumber = true;
      }
      return hasNumber;
    });
    return { columns, numericColumns };
  }

  function displayValue(value) {
    if (value === null || value === undefined) return "—";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? "" : displayValue(value);
    // Neutralize spreadsheet formulas without changing actual numeric values.
    if (typeof value !== "number" && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function toCsv(records, columns) {
    return "\uFEFF" + [columns.map(csvCell).join(";"), ...records.map(row => columns.map(column => csvCell(row[column])).join(";"))].join("\r\n");
  }

  function normalizeApiUrl(value) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Geçerli bir HTTP(S) API adresi girin; kullanıcı bilgisi, sorgu veya # içermemeli.");
    }
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Bağlantı bilgilerini korumak için uzak API adresi HTTPS kullanmalı.");
    }
    return url.href.replace(/\/+$/, "");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { numericValue, describeRecords, csvCell, toCsv, normalizeApiUrl };
  }
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const state = {
    mode: "disconnected", connection: null, apiUrl: "", sources: [],
    records: [], columns: [], numericColumns: [], chartType: "bar",
    sourceName: "", page: 0, chart: null
  };
  let revision = 0;
  let activeRequest = null;
  const demoRows = [
    ["Ocak", 42000, 28500], ["Şubat", 48500, 31000], ["Mart", 45200, 29800],
    ["Nisan", 56800, 34200], ["Mayıs", 62400, 37100], ["Haziran", 58900, 35600],
    ["Temmuz", 71500, 41200], ["Ağustos", 68200, 39800], ["Eylül", 79600, 44700],
    ["Ekim", 86400, 48200], ["Kasım", 82100, 46500], ["Aralık", 95800, 52100]
  ].map(([Ay, Satis, Gider]) => ({ Ay, Satis, Gider }));

  $("apiBaseUrl").value = document.querySelector('meta[name="api-base-url"]').content;

  function notice(message, type = "") {
    $("notice").textContent = message;
    $("notice").className = "notice" + (type ? " " + type : "");
    $("notice").hidden = !message;
  }

  function setBadge(text, type = "") {
    $("connectionBadge").className = "badge" + (type ? " " + type : "");
    const dot = document.createElement("span");
    dot.className = "status-dot";
    $("connectionBadge").replaceChildren(dot, document.createTextNode(text));
  }

  function setSteps(stage) {
    ["stepConnection", "stepSource", "stepChart"].forEach((id, index) => {
      $(id).className = index < stage ? "done" : index === stage ? "current" : "";
      if (index === stage) $(id).setAttribute("aria-current", "step");
      else $(id).removeAttribute("aria-current");
    });
  }

  function cancelRequest() {
    revision++;
    if (!activeRequest) return;
    activeRequest.controller.abort();
    activeRequest.release();
    activeRequest = null;
  }

  async function request(buttonId, endpoint, body) {
    const button = $(buttonId);
    const original = button.innerHTML;
    button.disabled = true;
    button.classList.add("busy");
    button.setAttribute("aria-busy", "true");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    const operation = {
      controller,
      release() {
        clearTimeout(timeout);
        button.innerHTML = original;
        button.disabled = false;
        button.classList.remove("busy");
        button.removeAttribute("aria-busy");
      }
    };
    activeRequest = operation;
    try {
      const response = await fetch(state.apiUrl + endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal, credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer"
      });
      if (!response.ok) {
        if (endpoint.includes("TestConnection")) throw new Error("Bağlantı kurulamadı. Sunucu, veritabanı ve kullanıcı bilgilerini kontrol edin.");
        if (endpoint.includes("GetDataSources")) throw new Error("Veri kaynakları alınamadı. Veritabanı erişim yetkilerini kontrol edip Yenile ile tekrar deneyin.");
        throw new Error("Veri alınamadı. Kaynak ve erişim yetkilerini kontrol edin. Parametre gerektiren prosedür ve fonksiyonlar bu ekranda desteklenmiyor.");
      }
      const payload = await response.json();
      if (activeRequest !== operation) throw new DOMException("İstek iptal edildi.", "AbortError");
      return payload;
    } catch (error) {
      if (timedOut) throw new Error("API 20 saniye içinde yanıt vermedi. Bağlantınızı kontrol edip tekrar deneyin.");
      if (error.name === "AbortError") throw error;
      if (error instanceof TypeError) throw new Error("API’ye ulaşılamadı. API adresini, HTTPS sertifikasını ve CORS ayarlarını kontrol edin.");
      if (error instanceof SyntaxError) throw new Error("API beklenen JSON yanıtını döndürmedi. API adresini kontrol edin.");
      throw error;
    } finally {
      clearTimeout(timeout);
      if (activeRequest === operation) {
        operation.release();
        activeRequest = null;
      }
    }
  }

  function clearChart() {
    if (state.chart) state.chart.destroy();
    state.chart = null;
    $("chartCanvasWrap").hidden = true;
    $("chartEmpty").hidden = false;
    $("downloadChartBtn").disabled = true;
    $("clearChartBtn").disabled = true;
    $("chartStatus").textContent = state.records.length ? "Grafik oluşturulmaya hazır" : "Veri bekleniyor";
    $("chartStatusDot").className = "status-dot";
    setSteps(state.records.length ? 2 : state.mode === "disconnected" ? 0 : 1);
  }

  function resetData() {
    state.records = [];
    state.columns = [];
    state.numericColumns = [];
    state.sourceName = "";
    state.page = 0;
    $("mappingFields").disabled = true;
    $("labelColumnSelect").replaceChildren();
    $("valueColumnSelect").replaceChildren();
    $("tableSearch").value = "";
    $("visualizationTitle").textContent = "Verinizin büyük resmi";
    $("chartSubtitle").textContent = "İlk grafiğiniz birkaç adım uzağınızda.";
    $("chartRecordInfo").textContent = "Veriniz burada hayat bulacak.";
    $("demoBadge").hidden = true;
    $("downloadCsvBtn").disabled = true;
    clearChart();
    renderTable();
    updateStats();
  }

  function resetConnection() {
    cancelRequest();
    state.mode = "disconnected";
    state.connection = null;
    state.apiUrl = "";
    state.sources = [];
    $("sourceFields").disabled = true;
    $("getDataBtn").disabled = true;
    $("dataSourceSelect").replaceChildren(new Option("Önce veritabanına bağlanın", ""));
    $("sourceHint").textContent = "Bağlantı kurulduğunda kaynaklar burada listelenir.";
    $("connectionResult").textContent = "Bağlantı bilgileri tarayıcıya kaydedilmez.";
    $("connectionResult").className = "connection-result";
    setBadge("Bağlantı bekleniyor");
    resetData();
    notice("");
  }

  async function connect(event) {
    event.preventDefault();
    resetConnection();
    const connection = {
      ServerName: $("serverName").value.trim(),
      DatabaseName: $("databaseName").value.trim(),
      UserName: $("userName").value.trim(),
      Password: $("password").value
    };
    if (!connection.ServerName || !connection.DatabaseName || !connection.UserName || !connection.Password) {
      notice("Lütfen tüm bağlantı alanlarını doldurun.", "error");
      return;
    }
    try {
      state.apiUrl = normalizeApiUrl($("apiBaseUrl").value);
    } catch (error) {
      document.querySelector(".api-settings").open = true;
      $("apiBaseUrl").focus();
      notice(error.message, "error");
      return;
    }
    const version = revision;
    $("connectionResult").textContent = "Bağlantı kontrol ediliyor…";
    setBadge("Bağlantı kontrol ediliyor");
    try {
      await request("testConnectionBtn", "/api/Connection/TestConnection", connection);
      if (version !== revision) return;
      state.mode = "live";
      state.connection = connection;
      $("connectionResult").textContent = "Bağlantı kuruldu. Verinizi seçebilirsiniz.";
      $("connectionResult").className = "connection-result success";
      $("sourceFields").disabled = false;
      setBadge("Veritabanı bağlı", "connected");
      setSteps(1);
      await loadSources();
    } catch (error) {
      if (version !== revision || error.name === "AbortError") return;
      $("connectionResult").textContent = error.message;
      $("connectionResult").className = "connection-result error";
      setBadge("Bağlantı kurulamadı");
      notice(error.message, "error");
    }
  }

  async function loadSources() {
    if (state.mode === "demo") {
      populateSources();
      $("dataSourceSelect").value = "0";
      $("getDataBtn").disabled = false;
      return;
    }
    if (state.mode !== "live") return;
    cancelRequest();
    const version = revision;
    resetData();
    state.sources = [];
    $("dataSourceSelect").replaceChildren(new Option("Kaynaklar yükleniyor…", ""));
    $("dataSourceSelect").disabled = true;
    $("getDataBtn").disabled = true;
    $("sourceHint").textContent = "Veritabanı nesneleri alınıyor…";
    notice("");
    try {
      const list = await request("loadDataSourcesBtn", "/api/Metadata/GetDataSources", state.connection);
      if (version !== revision) return;
      if (!Array.isArray(list)) throw new Error("API geçerli bir veri kaynağı listesi döndürmedi.");
      state.sources = list.filter(item => item && typeof item.name === "string" && ["Table", "View", "StoredProcedure", "Function"].includes(item.objectType));
      populateSources();
      if (!state.sources.length) notice("Bu veritabanında kullanılabilir veri kaynağı bulunamadı. Yetkilerinizi kontrol edip Yenile ile tekrar deneyin.", "warning");
    } catch (error) {
      if (version !== revision || error.name === "AbortError") return;
      $("dataSourceSelect").replaceChildren(new Option("Kaynaklar yüklenemedi", ""));
      $("sourceHint").textContent = "Kaynaklar alınamadı. Yenile ile tekrar deneyin.";
      notice(error.message, "error");
    } finally {
      if (version === revision) $("dataSourceSelect").disabled = false;
    }
  }

  function populateSources() {
    const types = { Table: "Tablo", View: "Görünüm", StoredProcedure: "Prosedür", Function: "Fonksiyon" };
    $("dataSourceSelect").replaceChildren(
      new Option(state.sources.length ? "Bir veri kaynağı seçin" : "Kullanılabilir kaynak bulunamadı", ""),
      ...state.sources.map((source, index) => new Option(source.name + " · " + types[source.objectType], String(index)))
    );
    $("dataSourceSelect").disabled = false;
    $("getDataBtn").disabled = true;
    $("sourceHint").textContent = state.mode === "demo" ? "Örnek kaynak · Gerçek veritabanına bağlanılmadı." :
      formatNumber.format(state.sources.length) + " kaynak bulundu. Parametre gerektiren nesneler desteklenmez.";
  }

  async function getData() {
    const selected = $("dataSourceSelect").value;
    const source = selected === "" ? null : state.sources[Number(selected)];
    if (!source) { notice("Önce bir veri kaynağı seçin.", "warning"); return; }
    cancelRequest();
    const version = revision;
    resetData();
    notice("");
    if (state.mode === "demo") {
      acceptData(demoRows.map(row => ({ ...row })), source.name);
      return;
    }
    try {
      const response = await request("getDataBtn", "/api/ChartData/GetData", {
        connectionParameters: state.connection, dataSourceName: source.name,
        objectType: source.objectType, parameters: {}
      });
      if (version !== revision) return;
      if (!response || !Array.isArray(response.records) || response.records.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error("API geçerli bir kayıt listesi döndürmedi.");
      }
      acceptData(response.records, source.name);
    } catch (error) {
      if (version !== revision || error.name === "AbortError") return;
      notice(error.message, "error");
    }
  }

  function acceptData(records, sourceName) {
    state.records = records;
    state.sourceName = sourceName;
    const description = describeRecords(records);
    state.columns = description.columns;
    state.numericColumns = description.numericColumns;
    $("labelColumnSelect").replaceChildren(...state.columns.map(column => new Option(column, column)));
    $("valueColumnSelect").replaceChildren(...state.numericColumns.map(column => new Option(column, column)));
    $("labelColumnSelect").value = state.columns.find(column => !state.numericColumns.includes(column)) || state.columns[0] || "";
    $("mappingFields").disabled = !records.length;
    $("drawChartBtn").disabled = !state.numericColumns.length;
    $("downloadCsvBtn").disabled = !records.length;
    $("demoBadge").hidden = state.mode !== "demo";
    $("visualizationTitle").textContent = state.mode === "demo" ? "Aylık satış performansı" : sourceName;
    $("chartSubtitle").textContent = state.mode === "demo" ? "Ocak – Aralık · Örnek satış ve gider verileri" : "Kolonları eşleştirerek verilerinizi görselleştirin.";
    $("chartRecordInfo").textContent = formatNumber.format(records.length) + " kayıt · " + formatNumber.format(state.columns.length) + " kolon";
    $("chartStatus").textContent = records.length ? "Grafik oluşturulmaya hazır" : "Kaynak boş";
    updateStats();
    renderTable();
    setSteps(records.length ? 2 : 1);
    if (!records.length) notice("Seçtiğiniz kaynakta kayıt yok. Başka bir kaynak seçebilir veya Yenile ile tekrar deneyebilirsiniz.", "warning");
    else if (!state.numericColumns.length) notice("Veriler yüklendi ancak grafik için uygun sayısal kolon bulunamadı. Verileri tablo sekmesinde inceleyebilir veya CSV olarak indirebilirsiniz.", "warning");
    else notice(formatNumber.format(records.length) + " kayıt hazır. Etiket ve değer kolonlarını seçip grafiğinizi oluşturun.");
  }

  function updateStats() {
    const hasData = state.records.length > 0;
    const hasSource = state.sourceName !== "";
    $("recordCount").textContent = hasSource ? formatNumber.format(state.records.length) : "—";
    $("columnCount").textContent = hasSource ? formatNumber.format(state.columns.length) : "—";
    $("tableCount").textContent = formatNumber.format(state.records.length);
    $("recordHint").textContent = hasData ? state.mode === "demo" ? "Örnek veri kümesi" : state.sourceName : "Henüz veri yüklenmedi";
    $("columnHint").textContent = hasData ? formatNumber.format(state.numericColumns.length) + " sayısal alan" : "Kaynağınızın alanları";
    const valueColumn = $("valueColumnSelect").value;
    const numbers = hasData && valueColumn ? state.records.map(row => numericValue(row[valueColumn])).filter(value => value !== null) : [];
    const total = numbers.reduce((sum, value) => sum + value, 0);
    $("valueTotal").textContent = numbers.length && Number.isFinite(total) ? formatNumber.format(total) : "—";
    $("totalHint").textContent = numbers.length ? valueColumn + " · " + formatNumber.format(numbers.length) + " sayısal kayıt" : "Sayısal kolon seçin";
  }

  function drawChart() {
    if (!state.records.length || !state.numericColumns.includes($("valueColumnSelect").value)) {
      notice("Grafik için veri ve sayısal bir değer kolonu seçin.", "warning");
      return;
    }
    if (typeof Chart === "undefined") {
      notice("Grafik kütüphanesi yüklenemedi. Ağ bağlantınızı kontrol edip sayfayı yenileyin. Verileri tablo sekmesinde inceleyebilirsiniz.", "error");
      return;
    }
    const labelColumn = $("labelColumnSelect").value;
    const valueColumn = $("valueColumnSelect").value;
    const rows = state.records.slice(0, CHART_LIMIT);
    const values = rows.map(row => numericValue(row[valueColumn]));
    const styles = getComputedStyle(document.documentElement);
    const token = name => styles.getPropertyValue(name).trim();
    clearChart();
    switchTab("chart");
    $("chartEmpty").hidden = true;
    $("chartCanvasWrap").hidden = false;
    const radial = state.chartType === "radar";
    const grid = token("--chart-grid");
    const color = token("--muted");
    const ticks = { color, font: { size: 11 }, callback: value => formatNumber.format(value) };
    try {
      state.chart = new Chart($("myChart"), {
        type: state.chartType,
        data: {
          labels: rows.map(row => displayValue(row[labelColumn])),
          datasets: [{
            label: valueColumn, data: values,
            backgroundColor: state.chartType === "bar" ? rows.map((_, index) => index === rows.length - 1 ? token("--accent") : token("--chart-secondary")) : token("--chart-fill"),
            borderColor: token("--accent"), borderWidth: state.chartType === "bar" ? 0 : 2.5,
            borderRadius: state.chartType === "bar" ? 5 : 0, maxBarThickness: 40,
            pointRadius: radial ? 3 : 4, pointBackgroundColor: token("--surface"),
            pointBorderWidth: 2, tension: .32, fill: state.chartType !== "bar", spanGaps: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, locale: "tr-TR",
          animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 350 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: token("--nav"), padding: 12, displayColors: false,
              callbacks: { label: context => valueColumn + ": " + formatNumber.format(radial ? context.parsed.r : context.parsed.y) }
            }
          },
          scales: radial ? {
            r: { beginAtZero: true, ticks: { ...ticks, backdropColor: token("--surface") }, grid: { color: grid }, angleLines: { color: grid }, pointLabels: { color, font: { size: 11 } } }
          } : {
            x: { grid: { display: false }, border: { display: false }, ticks: { color, maxRotation: 45, font: { size: 11 }, autoSkip: true, maxTicksLimit: 12 } },
            y: { beginAtZero: true, border: { display: false }, grid: { color: grid }, ticks: { ...ticks, maxTicksLimit: 6 } }
          }
        }
      });
      $("downloadChartBtn").disabled = false;
      $("clearChartBtn").disabled = false;
      $("chartStatus").textContent = "Grafik hazır · " + valueColumn;
      $("chartStatusDot").className = "status-dot ready";
      $("myChart").setAttribute("aria-label", valueColumn + " / " + labelColumn + " grafiği. Tüm değerlere Veri tablosu sekmesinden ulaşabilirsiniz.");
      const missing = values.filter(value => value === null).length;
      const messages = [];
      if (state.mode === "demo") messages.push("Örnek veri gösteriliyor; gerçek veritabanına bağlanılmadı.");
      if (state.records.length > CHART_LIMIT) messages.push("Okunabilirlik için grafikte ilk 100 kayıt gösteriliyor. Tablo, toplam ve CSV tüm kayıtları içerir.");
      if (missing) messages.push(missing + " eksik değer grafikte boş bırakıldı; sıfır kabul edilmedi.");
      notice(messages.join(" "), messages.length && state.mode !== "demo" ? "warning" : "");
      $("chartRecordInfo").textContent = formatNumber.format(rows.length) + " / " + formatNumber.format(state.records.length) + " kayıt · " + labelColumn;
      setSteps(3);
    } catch {
      clearChart();
      notice("Grafik oluşturulamadı. Verileri ve kolon eşleştirmesini kontrol edin; tablo önizlemesini kullanabilirsiniz.", "error");
    }
  }

  function filteredRows() {
    const search = $("tableSearch").value.trim().toLocaleLowerCase("tr-TR");
    return search ? state.records.filter(row => state.columns.some(column => displayValue(row[column]).toLocaleLowerCase("tr-TR").includes(search))) : state.records;
  }

  function renderTable() {
    const table = $("dataTable");
    const head = table.tHead;
    const body = table.tBodies[0];
    head.replaceChildren();
    body.replaceChildren();
    const rows = filteredRows();
    state.page = Math.max(0, Math.min(state.page, Math.ceil(rows.length / PAGE_SIZE) - 1));
    if (state.columns.length) {
      const header = document.createElement("tr");
      for (const column of state.columns) {
        const cell = document.createElement("th");
        cell.textContent = column;
        cell.scope = "col";
        if (state.numericColumns.includes(column)) cell.className = "numeric";
        header.append(cell);
      }
      head.append(header);
    }
    const start = state.page * PAGE_SIZE;
    for (const row of rows.slice(start, start + PAGE_SIZE)) {
      const tr = document.createElement("tr");
      for (const column of state.columns) {
        const cell = document.createElement("td");
        const value = row[column];
        const numeric = state.numericColumns.includes(column);
        const number = numeric ? numericValue(value) : null;
        cell.textContent = number === null ? displayValue(value) : formatNumber.format(number);
        cell.title = displayValue(value);
        if (numeric) cell.className = "numeric";
        tr.append(cell);
      }
      body.append(tr);
    }
    if (!rows.length) {
      const tr = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, state.columns.length);
      cell.className = "table-empty";
      cell.textContent = state.records.length ? "Aramanızla eşleşen kayıt bulunamadı." : "Önizleme için bir veri kaynağı yükleyin veya örnek veriyi deneyin.";
      tr.append(cell);
      body.append(tr);
    }
    $("tablePageInfo").textContent = rows.length ? (start + 1) + "–" + Math.min(start + PAGE_SIZE, rows.length) + " / " + formatNumber.format(rows.length) + " kayıt" : "0 kayıt";
    $("previousPageBtn").disabled = state.page === 0;
    $("nextPageBtn").disabled = start + PAGE_SIZE >= rows.length;
  }

  function switchTab(name, focus = false) {
    for (const tab of ["chart", "table"]) {
      const selected = name === tab;
      $(tab + "Tab").setAttribute("aria-selected", String(selected));
      $(tab + "Tab").tabIndex = selected ? 0 : -1;
      $(tab + "Tab").classList.toggle("active", selected);
      $(tab + "Panel").hidden = !selected;
    }
    if (name === "chart" && state.chart) state.chart.resize();
    if (focus) $(name + "Tab").focus();
  }

  function showDemo() {
    resetConnection();
    state.mode = "demo";
    state.sources = [{ name: "OrnekSatisVerisi", objectType: "Table" }];
    $("sourceFields").disabled = false;
    populateSources();
    $("dataSourceSelect").value = "0";
    $("getDataBtn").disabled = false;
    setBadge("Örnek veri modu", "demo");
    $("connectionResult").textContent = "Örnek moddasınız. Gerçek veriler için bağlantı kurabilirsiniz.";
    acceptData(demoRows.map(row => ({ ...row })), "OrnekSatisVerisi");
    drawChart();
    scrollToPreview();
    $("chartTab").focus({ preventScroll: true });
  }

  function scrollToPreview() {
    document.querySelector(".visualization-panel").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
  }

  function download(blob, extension) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (state.sourceName || "dynamic-chart").replace(/[^a-zA-Z0-9_-]/g, "_") + "." + extension;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("connectionForm").addEventListener("submit", connect);
  $("connectionForm").addEventListener("input", () => {
    if (state.mode === "demo") return;
    if (state.mode === "live" || activeRequest) {
      resetConnection();
      notice("Bağlantı bilgileri değişti. Devam etmek için bağlantıyı yeniden test edin.", "warning");
    }
  });
  $("togglePasswordBtn").addEventListener("click", () => {
    const visible = $("password").type === "password";
    $("password").type = visible ? "text" : "password";
    $("togglePasswordBtn").setAttribute("aria-pressed", String(visible));
    $("togglePasswordBtn").setAttribute("aria-label", visible ? "Şifreyi gizle" : "Şifreyi göster");
  });
  $("loadDataSourcesBtn").addEventListener("click", loadSources);
  $("dataSourceSelect").addEventListener("change", () => {
    cancelRequest();
    resetData();
    notice("");
    $("getDataBtn").disabled = $("dataSourceSelect").value === "";
  });
  $("getDataBtn").addEventListener("click", getData);
  $("drawChartBtn").addEventListener("click", drawChart);
  $("clearChartBtn").addEventListener("click", () => {
    clearChart();
    notice("Grafik temizlendi. Verileriniz korunuyor; farklı kolonlarla yeniden oluşturabilirsiniz.");
  });
  document.querySelectorAll("[data-chart-type]").forEach(button => {
    button.addEventListener("click", () => {
      state.chartType = button.dataset.chartType;
      document.querySelectorAll("[data-chart-type]").forEach(item => {
        const selected = item === button;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      if (state.chart) drawChart();
    });
  });
  ["labelColumnSelect", "valueColumnSelect"].forEach(id => $(id).addEventListener("change", () => {
    updateStats();
    if (state.chart) drawChart();
  }));
  ["demoBtn", "emptyDemoBtn", "sidebarDemoBtn"].forEach(id => $(id).addEventListener("click", showDemo));
  ["chart", "table"].forEach(name => {
    $(name + "Tab").addEventListener("click", () => switchTab(name));
    $(name + "Tab").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      switchTab(event.key === "Home" ? "chart" : event.key === "End" ? "table" : name === "chart" ? "table" : "chart", true);
    });
  });
  $("previewNavBtn").addEventListener("click", () => {
    switchTab("table", true);
    scrollToPreview();
  });
  $("tableSearch").addEventListener("input", () => { state.page = 0; renderTable(); });
  $("previousPageBtn").addEventListener("click", () => { state.page--; renderTable(); });
  $("nextPageBtn").addEventListener("click", () => { state.page++; renderTable(); });
  $("downloadCsvBtn").addEventListener("click", () => {
    if (state.records.length) download(new Blob([toCsv(state.records, state.columns)], { type: "text/csv;charset=utf-8" }), "csv");
  });
  $("downloadChartBtn").addEventListener("click", () => {
    if (!state.chart) return;
    const canvas = $("myChart");
    const image = document.createElement("canvas");
    image.width = canvas.width;
    image.height = canvas.height;
    const context = image.getContext("2d");
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    context.fillRect(0, 0, image.width, image.height);
    context.drawImage(canvas, 0, 0);
    image.toBlob(blob => {
      if (blob) download(blob, "png");
      else notice("Görsel indirilemedi. Lütfen tekrar deneyin.", "error");
    }, "image/png");
  });
})();

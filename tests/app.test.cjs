const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { numericValue, describeRecords, csvCell, toCsv, normalizeApiUrl } = require('../js/app.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }
const ok = payload => ({ ok: true, json: async () => payload });
const sources = [{ name: 'Sales', objectType: 'Table' }, { name: 'Summary', objectType: 'View' }];

function app(t, fetcher = async () => { throw new Error('Unexpected network request'); }) {
  const dom = new JSDOM(html, { url: 'http://localhost:8080', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const charts = [];
  const requests = [];
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.Chart = class {
    constructor(canvas, config) { this.config = config; this.destroyed = false; charts.push(this); }
    destroy() { this.destroyed = true; }
    resize() {}
  };
  window.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), signal: options.signal, options });
    return fetcher(url, options);
  };
  window.eval(script);
  const $ = id => window.document.getElementById(id);
  const click = id => $(id).click();
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const input = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  async function connect() {
    for (const [id, value] of Object.entries({ serverName: 'test-server', databaseName: 'TestDB', userName: 'test-user', password: 'test-only-placeholder' })) $(id).value = value;
    $('connectionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  }
  return { window, $, charts, requests, click, change, input, connect };
}

function api(records = [{ Category: 'A', Amount: 10 }, { Category: 'B', Amount: 20 }]) {
  return async url => url.endsWith('TestConnection') ? ok({ message: 'Connected' }) : url.endsWith('GetDataSources') ? ok(sources) : ok({ records });
}

test('numeric values are strict and missing/boolean/non-finite values are not zero', () => {
  for (const value of [null, undefined, '', ' ', false, true, Infinity, NaN, '12px', '1,5', {}, '0x20']) assert.equal(numericValue(value), null);
  for (const [input, expected] of [[0, 0], ['0', 0], [' -12.5 ', -12.5], ['1e3', 1000], ['.5', .5]]) assert.equal(numericValue(input), expected);
});

test('column discovery includes later keys and rejects mixed text and all-null columns', () => {
  assert.deepEqual(describeRecords([{ Label: 'A', Amount: null, Mixed: 3, Empty: null }, { Label: 'B', Amount: '12.5', Mixed: 'bad', Extra: 0 }]), {
    columns: ['Label', 'Amount', 'Mixed', 'Empty', 'Extra'], numericColumns: ['Amount', 'Extra']
  });
});

test('CSV quotes delimiters/newlines and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('a;"b"\nc'), '"a;""b""\nc"');
  for (const value of ['=SUM(A1)', '+CMD', '-CMD', '@SUM', '  =1+1', '\t1']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(-10), '"-10"');
  assert.equal(toCsv([{ Ay: 'Ocak', Satis: 12 }], ['Ay', 'Satis']), '\uFEFF"Ay";"Satis"\r\n"Ocak";"12"');
});

test('API URL permits HTTPS or loopback HTTP but rejects credential-bearing URLs', () => {
  assert.equal(normalizeApiUrl('https://example.com/api/'), 'https://example.com/api');
  assert.equal(normalizeApiUrl('http://localhost:5292/'), 'http://localhost:5292');
  assert.equal(normalizeApiUrl('http://[::1]:5292'), 'http://[::1]:5292');
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/?token=1', 'https://example.com/#x', 'no-url']) assert.throws(() => normalizeApiUrl(url));
});

test('initial view guides the user and disables dependent actions', t => {
  const { $, requests } = app(t);
  assert.equal($('sourceFields').disabled, true);
  assert.equal($('mappingFields').disabled, true);
  assert.equal($('downloadChartBtn').disabled, true);
  assert.equal($('chartEmpty').hidden, false);
  assert.equal($('recordCount').textContent, '—');
  assert.equal(requests.length, 0);
});

test('demo is explicitly labeled, works offline, infers mapping and switches all chart types', t => {
  const { $, window, charts, requests, click } = app(t);
  click('demoBtn');
  assert.equal(requests.length, 0);
  assert.equal($('recordCount').textContent, '12');
  assert.equal($('columnCount').textContent, '3');
  assert.equal($('labelColumnSelect').value, 'Ay');
  assert.equal($('valueColumnSelect').value, 'Satis');
  assert.equal($('demoBadge').hidden, false);
  assert.match($('connectionBadge').textContent, /Örnek/);
  assert.equal(charts.at(-1).config.type, 'bar');
  window.document.querySelector('[data-chart-type="line"]').click();
  assert.equal(charts.at(-1).config.type, 'line');
  window.document.querySelector('[data-chart-type="radar"]').click();
  assert.equal(charts.at(-1).config.type, 'radar');
  assert.ok(charts.at(-1).config.options.scales.r);
  assert.equal(charts.at(-1).config.options.scales.y, undefined);
  assert.equal(charts[0].destroyed, true);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
});

test('table pagination, Turkish search, empty results and keyboard tabs work', t => {
  const { $, window, click, input } = app(t);
  click('demoBtn');
  click('tableTab');
  assert.equal($('tablePanel').hidden, false);
  assert.equal($('dataTable').tBodies[0].rows.length, 8);
  click('nextPageBtn');
  assert.equal($('dataTable').tBodies[0].rows.length, 4);
  assert.match($('tablePageInfo').textContent, /9–12/);
  input('tableSearch', 'MAYIS');
  assert.equal($('dataTable').tBodies[0].rows.length, 1);
  assert.match($('dataTable').tBodies[0].textContent, /Mayıs/);
  input('tableSearch', 'does-not-exist');
  assert.match($('dataTable').textContent, /eşleşen kayıt bulunamadı/);
  $('tableTab').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal($('chartTab').getAttribute('aria-selected'), 'true');
  assert.equal(window.document.activeElement, $('chartTab'));
});

test('clearing a chart preserves loaded data and allows rebuilding', t => {
  const { $, charts, click } = app(t);
  click('demoBtn');
  click('clearChartBtn');
  assert.equal(charts[0].destroyed, true);
  assert.equal($('chartCanvasWrap').hidden, true);
  assert.equal($('recordCount').textContent, '12');
  assert.equal($('downloadCsvBtn').disabled, false);
  click('drawChartBtn');
  assert.equal($('chartCanvasWrap').hidden, false);
  assert.equal(charts.length, 2);
});

test('real API flow preserves endpoint and request contracts and auto-loads metadata', async t => {
  const { $, requests, change, click, connect } = app(t, api());
  await connect();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://localhost:44344/api/Connection/TestConnection');
  assert.deepEqual(Object.keys(requests[0].body), ['ServerName', 'DatabaseName', 'UserName', 'Password']);
  assert.deepEqual(requests[1].body, requests[0].body);
  assert.equal($('getDataBtn').disabled, true);
  change('dataSourceSelect', '1');
  click('getDataBtn');
  await settle();
  assert.deepEqual(requests[2].body, { connectionParameters: requests[0].body, dataSourceName: 'Summary', objectType: 'View', parameters: {} });
  assert.equal(requests[2].options.cache, 'no-store');
  assert.equal($('valueColumnSelect').value, 'Amount');
  assert.equal($('valueTotal').textContent, '30');
  assert.equal($('demoBadge').hidden, true);
});

test('connection edits invalidate downstream state and never reuse old credentials', async t => {
  const { $, input, click, change, connect } = app(t, api());
  await connect(); change('dataSourceSelect', '0'); click('getDataBtn'); await settle(); click('drawChartBtn');
  input('databaseName', 'OtherDB');
  assert.equal($('sourceFields').disabled, true);
  assert.equal($('mappingFields').disabled, true);
  assert.equal($('downloadChartBtn').disabled, true);
  assert.equal($('recordCount').textContent, '—');
  assert.match($('notice').textContent, /yeniden test/);
});

test('late source responses cannot replace newer data even when transport ignores abort', async t => {
  const pending = [];
  const fetcher = async url => url.endsWith('GetData') ? new Promise(resolve => pending.push(resolve)) : api()(url);
  const { $, requests, click, change, connect } = app(t, fetcher);
  await connect();
  change('dataSourceSelect', '0'); click('getDataBtn'); await settle();
  change('dataSourceSelect', '1'); click('getDataBtn'); await settle();
  assert.equal(requests[2].signal.aborted, true);
  pending[1](ok({ records: [{ Label: 'New', Value: 99 }] })); await settle();
  pending[0](ok({ records: [{ Label: 'Old', Value: 1 }, { Label: 'Stale', Value: 2 }] })); await settle();
  assert.equal($('visualizationTitle').textContent, 'Summary');
  assert.equal($('recordCount').textContent, '1');
  assert.equal($('valueTotal').textContent, '99');
});

test('connection failure after a previous success locks and clears the whole workflow', async t => {
  let fail = false;
  const { $, click, change, connect } = app(t, async url => fail ? { ok: false } : api()(url));
  await connect(); change('dataSourceSelect', '0'); click('getDataBtn'); await settle();
  fail = true;
  await connect();
  assert.equal($('sourceFields').disabled, true);
  assert.equal($('mappingFields').disabled, true);
  assert.equal($('recordCount').textContent, '—');
  assert.match($('notice').textContent, /Bağlantı kurulamadı/);
});

test('metadata failure is actionable and can be retried without reconnecting', async t => {
  let fail = true;
  const { $, click, connect } = app(t, async url => url.endsWith('GetDataSources') && fail ? { ok: false } : api()(url));
  await connect();
  assert.equal($('sourceFields').disabled, false);
  assert.match($('notice').textContent, /Yenile/);
  fail = false; click('loadDataSourcesBtn'); await settle();
  assert.equal($('dataSourceSelect').options.length, 3);
  assert.equal($('notice').hidden, true);
});

test('empty records, nonnumeric datasets and malformed responses have usable states', async t => {
  let records = [];
  let malformed = false;
  const { $, click, change, connect } = app(t, async url => url.endsWith('GetData') ? ok(malformed ? { nope: [] } : { records }) : api()(url));
  await connect(); change('dataSourceSelect', '0'); click('getDataBtn'); await settle();
  assert.equal($('recordCount').textContent, '0');
  assert.match($('notice').textContent, /kayıt yok/);
  records = [{ Name: 'Only text' }]; click('getDataBtn'); await settle();
  assert.equal($('drawChartBtn').disabled, true);
  assert.equal($('downloadCsvBtn').disabled, false);
  assert.match($('notice').textContent, /sayısal kolon bulunamadı/);
  malformed = true; click('getDataBtn'); await settle();
  assert.match($('notice').textContent, /geçerli bir kayıt listesi/);
  assert.equal($('downloadCsvBtn').disabled, true);
});

test('null values remain gaps and chart limit never changes totals or table size', async t => {
  const records = Array.from({ length: 105 }, (_, i) => ({ Label: 'Row ' + i, Amount: i === 0 ? null : 1 }));
  const { $, charts, click, change, connect } = app(t, api(records));
  await connect(); change('dataSourceSelect', '0'); click('getDataBtn'); await settle(); click('drawChartBtn');
  assert.equal(charts.at(-1).config.data.datasets[0].data[0], null);
  assert.equal(charts.at(-1).config.data.labels.length, 100);
  assert.equal($('recordCount').textContent, '105');
  assert.equal($('valueTotal').textContent, '104');
  assert.match($('notice').textContent, /ilk 100 kayıt/);
  assert.match($('notice').textContent, /eksik değer/);
});

test('API-provided names and cell values are rendered as text, never HTML', async t => {
  const injected = '<img src=x onerror="alert(1)">';
  const { $, window, click, change, connect } = app(t, api([{ [injected]: injected, Amount: 2 }]));
  await connect(); change('dataSourceSelect', '0'); click('getDataBtn'); await settle();
  assert.equal(window.document.querySelectorAll('img').length, 0);
  assert.equal($('dataTable').tHead.textContent, injected + 'Amount');
  assert.match($('dataTable').tBodies[0].textContent, /<img/);
});

test('missing chart library leaves table and CSV available and reports the recovery path', t => {
  const { $, window, click } = app(t);
  delete window.Chart;
  click('demoBtn');
  assert.match($('notice').textContent, /kütüphanesi yüklenemedi/);
  assert.equal($('downloadCsvBtn').disabled, false);
  assert.equal($('downloadChartBtn').disabled, true);
  click('tableTab');
  assert.equal($('dataTable').tBodies[0].rows.length, 8);
});

test('invalid API address is rejected before credentials leave the browser', async t => {
  const { $, requests, connect } = app(t, api());
  $('apiBaseUrl').value = 'http://remote.example';
  await connect();
  assert.equal(requests.length, 0);
  assert.match($('notice').textContent, /HTTPS/);
  assert.equal($('apiBaseUrl').closest('details').open, true);
});

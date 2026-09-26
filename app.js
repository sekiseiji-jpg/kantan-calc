(() => {
  "use strict";

  const exprEl = document.getElementById("expression");
  const resultEl = document.getElementById("result");
  const displayEl = document.querySelector(".display");

  // 画面に表示している入力中の数式（表示用記号を含む）
  let input = "";
  // 直前に「=」を押したかどうか
  let justEvaluated = false;

  /* ---------------- 数式評価エンジン（安全・eval不使用） ---------------- */

  function normalize(str) {
    return str.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  }

  function tokenize(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
      const c = str[i];
      if (c === " ") { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let num = "";
        while (i < str.length && /[0-9.]/.test(str[i])) {
          num += str[i++];
        }
        if ((num.match(/\./g) || []).length > 1) {
          throw new Error("数値が不正です");
        }
        tokens.push({ type: "num", value: parseFloat(num) });
        continue;
      }
      if ("+-*/%()".includes(c)) {
        tokens.push({ type: "op", value: c });
        i++;
        continue;
      }
      throw new Error("使用できない文字");
    }
    return tokens;
  }

  function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    // 式: 項 (("+"|"-") 項)*
    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = next().value;
        const right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }

    // 項: 因子 (("*"|"/") 因子)*
    function parseTerm() {
      let left = parseFactor();
      while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
        const op = next().value;
        const right = parseFactor();
        if (op === "*") left = left * right;
        else {
          if (right === 0) throw new Error("0では割れません");
          left = left / right;
        }
      }
      return left;
    }

    // 因子: 単項± ( 数値 | "(" 式 ")" ) "%"*
    function parseFactor() {
      let val;
      const t = peek();
      if (!t) throw new Error("式が途中で終わっています");
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        next();
        val = t.value === "-" ? -parseFactor() : parseFactor();
      } else if (t.type === "num") {
        next();
        val = t.value;
      } else if (t.type === "op" && t.value === "(") {
        next();
        val = parseExpr();
        const closing = next();
        if (!closing || closing.value !== ")") throw new Error("括弧が閉じていません");
      } else {
        throw new Error("式が不正です");
      }
      // 末尾の % は百分率（1/100）として扱う
      while (peek() && peek().type === "op" && peek().value === "%") {
        next();
        val = val / 100;
      }
      return val;
    }

    const value = parseExpr();
    if (pos < tokens.length) throw new Error("式が不正です");
    return value;
  }

  function evaluate(str) {
    const tokens = tokenize(normalize(str));
    if (tokens.length === 0) return null;
    const value = parse(tokens);
    if (!isFinite(value)) throw new Error("計算できません");
    return value;
  }

  function formatNumber(n) {
    if (Number.isInteger(n)) return n.toString();
    const rounded = parseFloat(n.toPrecision(12));
    return rounded.toString();
  }

  // 数値文字列に3桁区切りを付ける（符号・小数部はそのまま）
  function groupDigits(numStr) {
    const neg = numStr.startsWith("-");
    const body = neg ? numStr.slice(1) : numStr;
    const [intPart, decPart] = body.split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + (decPart !== undefined ? grouped + "." + decPart : grouped);
  }

  // 入力中の式（表示用）の数字に桁区切りを付ける（内部の input は変更しない）
  function formatExprForDisplay(str) {
    return str.replace(/\d+(\.\d+)?/g, (m) => groupDigits(m));
  }

  /* ---------------- 表示更新 ---------------- */

  // 結果を1行に収まる最大サイズで表示（iPadは大画面に合わせて大きく）
  const RESULT_MAX = 52;
  const RESULT_MAX_IPAD = 110;
  const RESULT_MIN = 18;
  function setResult(text) {
    resultEl.textContent = text;
    let size = document.documentElement.classList.contains("device-ipad") ? RESULT_MAX_IPAD : RESULT_MAX;
    resultEl.style.fontSize = size + "px";
    if (resultEl.clientWidth === 0) return; // レイアウト未確定時はスキップ
    // 表示板の高さ（数式表示分を除く）内に収まる上限も算出（縦のはみ出し防止）
    const availH = displayEl
      ? displayEl.clientHeight - 28 - exprEl.offsetHeight - 6
      : 0;
    while (size > RESULT_MIN && (
        resultEl.scrollWidth > resultEl.clientWidth ||
        (availH > 0 && resultEl.scrollHeight > availH))) {
      size -= 1;
      resultEl.style.fontSize = size + "px";
    }
  }

  function render() {
    exprEl.textContent = formatExprForDisplay(input);
    resultEl.classList.remove("error");
    if (input === "") {
      setResult("0");
      return;
    }
    try {
      const value = evaluate(input);
      setResult(value === null ? "0" : groupDigits(formatNumber(value)));
    } catch (e) {
      setResult("");
    }
  }

  function showError(message) {
    resultEl.classList.add("error");
    setResult(message);
  }

  /* ---------------- 入力ハンドリング ---------------- */

  const binaryOps = ["+", "-", "×", "÷"];

  function appendValue(value) {
    // = の直後の継続入力（input には結果のプレーン値が入っている）
    if (justEvaluated) {
      if (!binaryOps.includes(value) && value !== "%" && value !== "." && value !== ")") {
        input = "";
      }
      justEvaluated = false;
    }

    const last = input.slice(-1);

    // % は後置（数値・閉じ括弧・% の直後のみ）
    if (value === "%") {
      if (input === "" || binaryOps.includes(last) || last === "(" || last === ".") return;
      input += value;
      render();
      return;
    }

    // ) は対応する ( がある場合のみ。演算子・( の直後は不可
    if (value === ")") {
      const opens = (input.match(/\(/g) || []).length;
      const closes = (input.match(/\)/g) || []).length;
      if (opens <= closes || binaryOps.includes(last) || last === "(") return;
    }

    // 掛け算の省略を補う（例: 2( → 2×(、(1+2)3 → (1+2)×3、50%( → 50%×(）
    let prefix = "";
    if (value === "(" && /[0-9.)%]/.test(last)) prefix = "×";
    else if (/^[0-9.]/.test(value) && (last === ")" || last === "%")) prefix = "×";

    // 000：先頭や演算子直後では 0 ひとつだけにする
    if (value === "000") {
      if (input === "" || prefix || binaryOps.includes(last) || last === "(") {
        value = "0";
      } else if (last === "0") {
        // すでに「0」単独の数なら増やさない（0000防止）
        const lastNumber = input.split(/[+\-×÷%()]/).pop();
        if (lastNumber === "0") return;
      }
    }

    if (binaryOps.includes(value)) {
      if (input === "") {
        if (value === "-") input += value;
        return;
      }
      if (binaryOps.includes(last)) {
        input = input.slice(0, -1) + value;
        render();
        return;
      }
    }

    if (value === ".") {
      const lastNumber = input.split(/[+\-×÷%()]/).pop();
      if (lastNumber.includes(".")) return;
      if (input === "" || prefix || binaryOps.includes(last) || last === "(") {
        value = "0.";
      }
    }

    input += prefix + value;
    render();
  }

  function clearAll() {
    input = "";
    justEvaluated = false;
    render();
  }

  function backspace() {
    if (justEvaluated) justEvaluated = false;
    input = input.slice(0, -1);
    render();
  }

  function equals() {
    if (input === "") return;
    try {
      const value = evaluate(input);
      if (value === null) return;
      const formatted = formatNumber(value);
      exprEl.textContent = formatExprForDisplay(input) + " =";
      resultEl.classList.remove("error");
      setResult(groupDigits(formatted));
      addHistory(input, formatted);
      input = formatted;
      justEvaluated = true;
    } catch (e) {
      showError(e.message || "エラー");
      justEvaluated = false;
    }
  }

  /* ---------------- 消費税計算 ---------------- */

  const TAX_KEY = "kantan-calc-taxrate";
  let taxRate = 10; // %

  // mode: "in"=税込（×(1+率)） / "out"=税抜（÷(1+率)）
  function applyTax(mode) {
    if (input === "") return;
    try {
      const value = evaluate(input);
      if (value === null) return;
      const factor = 1 + taxRate / 100;
      const taxed = mode === "in" ? value * factor : value / factor;
      if (!isFinite(taxed)) throw new Error("計算できません");
      const formatted = formatNumber(taxed);
      const label = (mode === "in" ? "税込" : "税抜") + taxRate + "%";
      exprEl.textContent = formatExprForDisplay(input) + " → " + label;
      resultEl.classList.remove("error");
      setResult(groupDigits(formatted));
      addHistory(input, formatted, "(" + label + ")");
      input = formatted;
      justEvaluated = true;
    } catch (e) {
      showError(e.message || "エラー");
      justEvaluated = false;
    }
  }

  function updateTaxButtons() {
    const inBtn = document.getElementById("taxInBtn");
    const outBtn = document.getElementById("taxOutBtn");
    if (inBtn) inBtn.textContent = "税込 " + taxRate + "%";
    if (outBtn) outBtn.textContent = "税抜 " + taxRate + "%";
  }

  function setTaxRate(rate) {
    taxRate = rate;
    updateTaxButtons();
    try { localStorage.setItem(TAX_KEY, String(rate)); } catch (e) { /* noop */ }
  }

  /* ---------------- 履歴機能 ---------------- */

  const HISTORY_KEY = "kantan-calc-history";
  const MAX_HISTORY = 50;
  let history = [];

  const historyPanel = document.getElementById("historyPanel");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");

  function loadHistory() {
    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch (e) {
      history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* 保存できなくても動作は継続 */ }
  }

  function addHistory(expr, result, note) {
    history.unshift({ expr, result, note: note || "" });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory();
  }

  function renderHistory() {
    historyList.innerHTML = "";
    historyEmpty.classList.toggle("hidden", history.length > 0);
    history.forEach((h, index) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.dataset.index = index;
      const e = document.createElement("div");
      e.className = "history-expr";
      e.dataset.use = "expr";
      e.textContent = formatExprForDisplay(h.expr) + (h.note ? " " + h.note : " =");
      const r = document.createElement("div");
      r.className = "history-result";
      r.dataset.use = "result";
      r.textContent = groupDigits(h.result);
      li.append(e, r);
      historyList.appendChild(li);
    });
  }

  function openHistory() {
    renderHistory();
    historyPanel.classList.remove("hidden");
  }
  function closeHistory() {
    historyPanel.classList.add("hidden");
  }

  historyList.addEventListener("click", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    const h = history[item.dataset.index];
    if (!h) return;
    const target = e.target.closest("[data-use]");
    // 結果をタップ→結果を使用、式をタップ（既定）→式を呼び出して編集
    input = target && target.dataset.use === "result" ? h.result : h.expr;
    justEvaluated = false;
    render();
    closeHistory();
  });

  document.getElementById("historyBtn").addEventListener("click", openHistory);
  document.getElementById("closeHistory").addEventListener("click", closeHistory);
  document.getElementById("clearHistory").addEventListener("click", () => {
    history = [];
    saveHistory();
    renderHistory();
  });

  /* ---------------- テーマ機能 ---------------- */

  const BODY_KEY = "kantan-calc-body";
  const BG_KEY = "kantan-calc-bg";

  // 本体（箱）の色 → data-body で --calc-bg を変更
  const BODY_COLORS = [
    { key: "white",    label: "ホワイト", color: "#ffffff" },
    { key: "aqua",     label: "水色",     color: "#cfe9f7" },
    { key: "sakura",   label: "ピンク",   color: "#ffe1ec" },
    { key: "mint",     label: "グリーン", color: "#d6f5e3" },
    { key: "lavender", label: "パープル", color: "#e7defb" },
    { key: "dark",     label: "ダーク",   color: "#1f2933" },
  ];

  // 背景（ページ）の色 → --bg を変更
  const BG_COLORS = [
    { key: "default", label: "標準",     color: "#eef1f4" },
    { key: "white",   label: "ホワイト", color: "#ffffff" },
    { key: "cream",   label: "クリーム", color: "#fff7e6" },
    { key: "pink",    label: "ピンク",   color: "#ffeef4" },
    { key: "mint",    label: "ミント",   color: "#eafaf1" },
    { key: "sky",     label: "スカイ",   color: "#eaf6fd" },
    { key: "gray",    label: "グレー",   color: "#eceff1" },
  ];

  const themePanel = document.getElementById("themePanel");
  const themeBtn = document.getElementById("themeBtn");

  let currentBody = "dark";
  let currentBg = "default";

  // 本体（箱）の色を変更
  function applyBody(key) {
    currentBody = key;
    if (key === "white") {
      delete document.documentElement.dataset.body; // 既定（白）に戻す
    } else {
      document.documentElement.dataset.body = key;
    }
    try { localStorage.setItem(BODY_KEY, key); } catch (e) { /* noop */ }
  }

  // 背景（ページ）の色を変更
  function applyBg(key) {
    currentBg = key;
    const root = document.documentElement;
    const c = BG_COLORS.find((x) => x.key === key);
    if (!c || key === "default") {
      root.style.removeProperty("--bg");
    } else {
      root.style.setProperty("--bg", c.color);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && c) meta.setAttribute("content", c.color);
    try { localStorage.setItem(BG_KEY, key); } catch (e) { /* noop */ }
  }

  function buildThemePanel() {
    // 本体（箱）の色
    const bodySection = document.createElement("div");
    bodySection.className = "theme-section";
    bodySection.innerHTML = '<span class="theme-label">本体</span>';
    const bodyRow = document.createElement("div");
    bodyRow.className = "swatch-row";
    BODY_COLORS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = t.color;
      b.title = t.label;
      b.setAttribute("aria-label", "本体：" + t.label);
      b.dataset.kind = "body";
      b.dataset.value = t.key;
      bodyRow.appendChild(b);
    });
    bodySection.appendChild(bodyRow);

    // 背景（ページ）の色
    const bgSection = document.createElement("div");
    bgSection.className = "theme-section";
    bgSection.innerHTML = '<span class="theme-label">背景</span>';
    const bgRow = document.createElement("div");
    bgRow.className = "swatch-row";
    BG_COLORS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "swatch";
      if (c.key === "default") b.classList.add("is-default");
      else b.style.background = c.color;
      b.title = c.label;
      b.setAttribute("aria-label", "背景：" + c.label);
      b.dataset.kind = "bg";
      b.dataset.value = c.key;
      bgRow.appendChild(b);
    });
    bgSection.appendChild(bgRow);

    // 消費税率
    const taxSection = document.createElement("div");
    taxSection.className = "theme-section";
    taxSection.innerHTML = '<span class="theme-label">消費税率</span>';
    const taxRow = document.createElement("div");
    taxRow.className = "rate-row";
    [10, 8].forEach((rate) => {
      const b = document.createElement("button");
      b.className = "rate-btn";
      b.textContent = rate + "%";
      b.dataset.rate = String(rate);
      taxRow.appendChild(b);
    });
    const rateInput = document.createElement("input");
    rateInput.type = "number";
    rateInput.className = "rate-input";
    rateInput.min = "0";
    rateInput.max = "100";
    rateInput.step = "0.1";
    rateInput.placeholder = "任意%";
    rateInput.setAttribute("aria-label", "任意の税率（%）");
    taxRow.appendChild(rateInput);
    taxSection.appendChild(taxRow);

    themePanel.append(bodySection, bgSection, taxSection);
  }

  function markSelectedSwatch() {
    themePanel.querySelectorAll(".swatch").forEach((s) => {
      const sel = (s.dataset.kind === "body" && s.dataset.value === currentBody) ||
                  (s.dataset.kind === "bg" && s.dataset.value === currentBg);
      s.classList.toggle("selected", sel);
    });
    themePanel.querySelectorAll(".rate-btn").forEach((b) => {
      b.classList.toggle("selected", Number(b.dataset.rate) === taxRate);
    });
    const ri = themePanel.querySelector(".rate-input");
    if (ri && document.activeElement !== ri) ri.value = String(taxRate);
  }

  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = themePanel.classList.contains("hidden");
    if (willOpen) markSelectedSwatch();
    themePanel.classList.toggle("hidden");
  });

  themePanel.addEventListener("click", (e) => {
    const rate = e.target.closest(".rate-btn");
    if (rate) {
      setTaxRate(Number(rate.dataset.rate));
      markSelectedSwatch();
      return;
    }
    const sw = e.target.closest(".swatch");
    if (!sw) return;
    if (sw.dataset.kind === "body") applyBody(sw.dataset.value);
    else applyBg(sw.dataset.value);
    markSelectedSwatch();
  });

  // 任意の税率入力
  themePanel.addEventListener("input", (e) => {
    if (!e.target.classList.contains("rate-input")) return;
    const v = parseFloat(e.target.value);
    if (isNaN(v) || v < 0 || v > 100) return;
    setTaxRate(v);
    markSelectedSwatch();
  });

  // 入力確定時、範囲外・空欄なら現在の税率表示に戻す
  themePanel.addEventListener("change", (e) => {
    if (e.target.classList.contains("rate-input")) e.target.value = String(taxRate);
  });

  // パネル外クリックで閉じる
  document.addEventListener("click", (e) => {
    if (!themePanel.classList.contains("hidden") &&
        !themePanel.contains(e.target) && e.target !== themeBtn) {
      themePanel.classList.add("hidden");
    }
  });

  /* ---------------- キーパッド・キーボード ---------------- */

  document.querySelector(".keys").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const value = btn.dataset.value;
    if (action === "clear") clearAll();
    else if (action === "back") backspace();
    else if (action === "equals") equals();
    else if (action === "tax-in") applyTax("in");
    else if (action === "tax-out") applyTax("out");
    else if (value != null) appendValue(value);
  });

  document.addEventListener("keydown", (e) => {
    const k = e.key;
    if (/[0-9]/.test(k)) appendValue(k);
    else if (k === ".") appendValue(".");
    else if (k === "+") appendValue("+");
    else if (k === "-") appendValue("-");
    else if (k === "*") appendValue("×");
    else if (k === "/") { e.preventDefault(); appendValue("÷"); }
    else if (k === "%") appendValue("%");
    else if (k === "(") appendValue("(");
    else if (k === ")") appendValue(")");
    else if (k === "Enter" || k === "=") { e.preventDefault(); equals(); }
    else if (k === "Backspace") backspace();
    else if (k === "Escape") clearAll();
  });

  /* ---------------- 初期化 ---------------- */

  let savedBody = "dark";
  let savedBg = "default";
  let savedTax = 10;
  try {
    savedBody = localStorage.getItem(BODY_KEY) || "dark";
    savedBg = localStorage.getItem(BG_KEY) || "default";
    // 0% も有効な値として復元する（|| だと 0 が 10 に戻ってしまう）
    const t = parseFloat(localStorage.getItem(TAX_KEY));
    if (t >= 0 && t <= 100) savedTax = t;
  } catch (e) { /* noop */ }
  applyBody(savedBody);
  applyBg(savedBg);
  setTaxRate(savedTax);
  buildThemePanel();
  loadHistory();
  render();

  // 画面幅が変わったら結果サイズを再調整
  window.addEventListener("resize", () => setResult(resultEl.textContent));

  // 実行プラットフォーム・端末種別をclassに反映
  if (window.Capacitor && typeof window.Capacitor.getPlatform === "function") {
    const platform = window.Capacitor.getPlatform();
    const root = document.documentElement;
    root.classList.add("platform-" + platform);
    if (platform === "ios") {
      // iPadOSのWebViewは "iPad" を含まずMacのUAを返すことがあるため、iPhone判定で振り分ける
      const isIphone = /iPhone|iPod/.test(navigator.userAgent);
      root.classList.add(isIphone ? "device-iphone" : "device-ipad");
      if (isIphone) root.classList.add("big-digits"); // iPhone は数字キー拡大
    } else if (platform === "android") {
      root.classList.add("big-digits"); // Android は数字キー拡大
    }
  }

  // 端末別レイアウト確定後に結果サイズを再フィット
  setResult(resultEl.textContent);

  // ネイティブ（Capacitor）ではSW不要。Webのみ登録する。
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative) {
    // 旧Service Worker・キャッシュを除去し、常にバンドルの最新を表示（履歴・設定のlocalStorageは残る）
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    }
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
  } else if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();

(function () {
  "use strict";

  var Sim = window.QueueSim;
  var FIELDS = {
    requestRate: { min: 0.1, max: 1000, integer: false },
    processingTime: { min: 1, max: 60000, integer: true },
    workers: { min: 1, max: 100, integer: true },
    duration: { min: 1, max: 300, integer: true },
    initialQueue: { min: 0, max: 10000, integer: true },
  };
  var STATUS_TEXT = { stable: "Стабільна робота", edge: "Робота на межі", overload: "Перевантаження" };
  var STATUS_COLOR = { stable: "#22c55e", edge: "#eab308", overload: "#ef4444" };
  var STEP_MS = 380;

  var $ = function (id) { return document.getElementById(id); };
  var form = $("configForm");
  var runToken = 0;
  var lastResult = null;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var fmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
  var fmt0 = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

  function readConfig() {
    var cfg = {};
    Object.keys(FIELDS).forEach(function (k) { cfg[k] = Number($(k).value); });
    return cfg;
  }

  function writeConfig(cfg) {
    Object.keys(FIELDS).forEach(function (k) {
      $(k).value = cfg[k];
      $(k).classList.remove("is-invalid");
    });
    onConfigChange();
  }

  function validateField(k) {
    var el = $(k);
    var rule = FIELDS[k];
    var v = el.value.trim() === "" ? NaN : Number(el.value);
    var ok = isFinite(v) && v >= rule.min && v <= rule.max && (!rule.integer || Number.isInteger(v));
    el.classList.toggle("is-invalid", !ok);
    el.setAttribute("aria-invalid", ok ? "false" : "true");
    return ok;
  }

  function validateAll() {
    var ok = true;
    Object.keys(FIELDS).forEach(function (k) { if (!validateField(k)) ok = false; });
    return ok;
  }

  function capacityOf(cfg) { return cfg.workers / (cfg.processingTime / 1000); }

  function setStatusPill(status, label) {
    var pill = $("navStatus");
    pill.className = "status-pill status-" + status;
    pill.textContent = label;
  }

  function renderWorkers(n, busy) {
    var box = $("workerLeds");
    var shown = Math.min(n, 40);
    if (box.children.length !== shown) {
      box.innerHTML = "";
      for (var i = 0; i < shown; i++) box.appendChild(document.createElement("span"));
    }
    var busyShown = Math.round((Math.min(busy, n) / n) * shown);
    Array.prototype.forEach.call(box.children, function (el, i) { el.classList.toggle("busy", i < busyShown); });
  }

  function setQueueVisual(queue, status) {
    $("sQueue").textContent = fmt0.format(queue);
    var node = $("queueNode");
    node.classList.toggle("is-edge", status === "edge");
    node.classList.toggle("is-overload", status === "overload");
    var fill = $("queueFill");
    var scale = Math.max(20, (lastResult && lastResult.maximumQueueLength) || 0, queue);
    var pct = Math.min(100, (queue / scale) * 100);
    fill.style.width = (queue > 0 ? Math.max(4, pct) : 0) + "%";
    fill.style.background = STATUS_COLOR[status] || STATUS_COLOR.stable;
  }

  function onConfigChange() {
    var valid = Object.keys(FIELDS).every(function (k) {
      var v = Number($(k).value);
      return $(k).value !== "" && isFinite(v) && v >= FIELDS[k].min && v <= FIELDS[k].max;
    });
    if (!valid) return;
    var cfg = readConfig();
    var cap = capacityOf(cfg);
    var ratio = cfg.requestRate / cap;
    var status = Sim.classifyLoad(ratio);

    $("sRate").textContent = fmt.format(cfg.requestRate);
    $("sWorkers").textContent = cfg.workers;
    $("sProc").textContent = cfg.processingTime;
    $("sCap").textContent = fmt.format(cap);
    $("formulaValue").textContent =
      cfg.workers + " / " + fmt.format(cfg.processingTime / 1000) + " = " + fmt.format(cap) + " req/s";
    renderWorkers(cfg.workers, 0);

    var box = $("expectedBox");
    box.className = "state-box state-" + status + " p-3 mb-3";
    $("expectedTitleText").textContent = STATUS_TEXT[status];
    $("expectedRatio").textContent = "ρ = λ / Capacity = " + ratio.toFixed(2);
    var texts = {
      stable: "Навантаження (" + fmt.format(cfg.requestRate) + " req/s) нижче пропускної здатності (" + fmt.format(cap) +
        " req/s). Очікується, що черга не накопичуватиметься" + (cfg.initialQueue > 0 ? ", а початкова черга швидко зникне." : "."),
      edge: "Навантаження (" + fmt.format(cfg.requestRate) + " req/s) приблизно дорівнює пропускній здатності (" + fmt.format(cap) +
        " req/s). Очікується робота на межі можливостей із можливими коливаннями черги.",
      overload: "Навантаження (" + fmt.format(cfg.requestRate) + " req/s) перевищує пропускну здатність (" + fmt.format(cap) +
        " req/s). Очікується, що черга зростатиме приблизно на " + fmt.format(cfg.requestRate - cap) + " запитів щосекунди.",
    };
    $("expectedText").textContent = texts[status];
  }

  /* ---------- Графік ---------- */
  function drawChart(result, uptoTime) {
    var canvas = $("queueChart");
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth;
    var h = 260;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var pad = { l: 44, r: 12, t: 12, b: 28 };
    var pw = w - pad.l - pad.r;
    var ph = h - pad.t - pad.b;
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.fillStyle = "#8b9ab5";
    ctx.strokeStyle = "#22304f";
    ctx.lineWidth = 1;

    if (!result) {
      ctx.textAlign = "center";
      ctx.fillText("Немає даних", w / 2, h / 2);
      return;
    }

    var dur = result.simulationDuration;
    var maxQ = Math.max(5, result.maximumQueueLength);
    var niceMax = Math.ceil(maxQ / 5) * 5;

    ctx.textAlign = "right";
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + ph - (ph * g) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
      ctx.fillText(fmt0.format((niceMax * g) / 4), pad.l - 6, gy + 4);
    }
    ctx.textAlign = "center";
    var stepX = Math.max(1, Math.ceil(dur / 10));
    for (var s = 0; s <= dur; s += stepX) {
      ctx.fillText(s + "с", pad.l + (pw * s) / dur, h - 8);
    }

    var status = Sim.analyze(result).status;
    var color = STATUS_COLOR[status];
    var pts = result.queueSamples.filter(function (p) { return p.t <= uptoTime + 1e-9; });
    if (!pts.length) return;

    var x = function (t) { return pad.l + (pw * t) / dur; };
    var y = function (q) { return pad.t + ph - (ph * q) / niceMax; };

    ctx.beginPath();
    ctx.moveTo(x(pts[0].t), y(0));
    pts.forEach(function (p) { ctx.lineTo(x(p.t), y(p.queue)); });
    ctx.lineTo(x(pts[pts.length - 1].t), y(0));
    ctx.closePath();
    ctx.fillStyle = color + "22";
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(x(p.t), y(p.queue)); else ctx.moveTo(x(p.t), y(p.queue)); });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ---------- Рендер результатів ---------- */
  function rowHtml(iv) {
    return "<td>" + iv.time + "</td><td>" + iv.newRequests + "</td><td>" + iv.processed + "</td><td>" +
      iv.queueLength + "</td><td>" + fmt0.format(iv.waitingTime) + "</td>";
  }

  function renderMetrics(result) {
    var a = Sim.analyze(result);
    var cls = { stable: "v-ok", edge: "v-warn", overload: "v-bad" }[a.status];
    $("mTotal").textContent = fmt0.format(result.totalRequests);
    $("mProcessed").textContent = fmt0.format(result.processedRequests);
    $("mQueue").textContent = fmt0.format(result.remainingQueue);
    $("mMaxQueue").textContent = fmt0.format(result.maximumQueueLength);
    $("mWait").textContent = fmt0.format(result.averageWaitingTime);
    $("mCap").textContent = fmt.format(result.systemCapacity);
    $("mUtil").textContent = fmt.format(result.utilization);
    ["mQueue", "mMaxQueue", "mWait", "mUtil"].forEach(function (id) {
      $(id).className = "metric-value " + (result[id === "mUtil" ? "utilization" : "remainingQueue"] > 0 || id === "mUtil" ? cls : "");
    });
    var fill = $("utilFill");
    fill.style.width = result.utilization + "%";
    fill.style.background = STATUS_COLOR[a.status];

    $("analysisBox").className = "state-box state-" + a.status + " p-3 p-lg-4 mb-3";
    $("analysisTitle").textContent = a.title;
    $("analysisText").textContent = a.text +
      " Середня довжина черги — " + fmt.format(result.averageQueueLength) + " req, у процесі обробки на кінець — " + result.inProgress + " req.";
    $("resultsHint").textContent =
      "λ = " + fmt.format(result.config.requestRate) + " req/s · Capacity = " + fmt.format(result.systemCapacity) +
      " req/s · " + result.simulationDuration + " с";
    setStatusPill(a.status, a.title);
  }

  function finishRun(result) {
    var body = $("resultsBody");
    body.innerHTML = result.intervals.map(function (iv) { return "<tr>" + rowHtml(iv) + "</tr>"; }).join("");
    renderSchemaAt(result, result.intervals.length);
    renderMetrics(result);
    drawChart(result, result.simulationDuration);
    setRunning(false);
  }

  function renderSchemaAt(result, count) {
    var arrived = result.config.initialQueue;
    var processed = 0;
    for (var i = 0; i < count; i++) {
      arrived += result.intervals[i].newRequests;
      processed += result.intervals[i].processed;
    }
    var iv = result.intervals[Math.max(0, count - 1)];
    var queue = count ? iv.queueLength : result.config.initialQueue;
    var inService = Math.max(0, arrived - processed - queue);
    $("sArrived").textContent = fmt0.format(arrived);
    $("sProcessed").textContent = fmt0.format(processed);
    $("schemaClock").textContent = "t = " + count + " с";
    var liveStatus = queue > result.config.workers * 2 && count > 1 && queue >= result.intervals[Math.max(0, count - 2)].queueLength
      ? "overload"
      : inService >= result.config.workers ? "edge" : "stable";
    setQueueVisual(queue, liveStatus);
    renderWorkers(result.config.workers, inService);
  }

  function spawnDots(containerId, count) {
    if (reduceMotion || !count) return;
    var box = $(containerId);
    var n = Math.min(count, 6);
    for (var i = 0; i < n; i++) {
      (function (delay) {
        setTimeout(function () {
          var d = document.createElement("i");
          box.appendChild(d);
          setTimeout(function () { d.remove(); }, 950);
        }, delay);
      })((STEP_MS / n) * i);
    }
  }

  function setRunning(running) {
    $("runBtn").disabled = running;
    $("runBtn").textContent = running ? "Симуляція триває…" : "Запустити симуляцію";
    if (running) setStatusPill("running", "Симуляція триває");
  }

  function run() {
    if (!validateAll()) {
      var firstInvalid = form.querySelector(".is-invalid");
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    var result = Sim.simulate(readConfig());
    lastResult = result;
    var token = ++runToken;

    if (!$("animateToggle").checked || reduceMotion) {
      finishRun(result);
      return;
    }

    setRunning(true);
    var body = $("resultsBody");
    body.innerHTML = "";
    renderSchemaAt(result, 0);
    drawChart(result, 0);
    var i = 0;
    (function step() {
      if (token !== runToken) return;
      if (i >= result.intervals.length) { finishRun(result); return; }
      var iv = result.intervals[i];
      var tr = document.createElement("tr");
      tr.className = "row-new";
      tr.innerHTML = rowHtml(iv);
      body.appendChild(tr);
      tr.scrollIntoView({ block: "nearest" });
      i++;
      renderSchemaAt(result, i);
      drawChart(result, i);
      spawnDots("dotsIn", iv.newRequests);
      spawnDots("dotsOut", iv.processed);
      setTimeout(step, STEP_MS);
    })();
  }

  function compareAll() {
    var rows = window.SCENARIOS.map(function (sc) {
      var r = Sim.simulate(sc.config);
      var a = Sim.analyze(r);
      return "<tr><th scope='row' class='fw-medium'>" + sc.name + "<div class='small text-body-secondary fw-normal'>" + sc.expected + "</div></th>" +
        "<td class='mono'>" + fmt.format(sc.config.requestRate) + " req/s<div class='small text-body-secondary'>ρ = " + r.loadRatio.toFixed(2) + "</div></td>" +
        "<td class='mono'>" + fmt.format(r.systemCapacity) + " req/s</td>" +
        "<td class='mono'>" + r.processedRequests + " / " + r.totalRequests + "</td>" +
        "<td class='mono'>" + r.remainingQueue + " <span class='small text-body-secondary'>(макс. " + r.maximumQueueLength + ")</span></td>" +
        "<td class='mono'>" + fmt0.format(r.averageWaitingTime) + " мс</td>" +
        "<td><span class='chip chip-" + a.status + "'>" + a.title + "</span></td></tr>";
    });
    $("compareBody").innerHTML = rows.join("");
  }

  /* ---------- Ініціалізація ---------- */
  var select = $("scenarioSelect");
  window.SCENARIOS.forEach(function (sc, i) {
    var o = document.createElement("option");
    o.value = i;
    o.textContent = sc.name;
    select.appendChild(o);
  });

  Object.keys(FIELDS).forEach(function (k) {
    $(k).addEventListener("input", function () { validateField(k); onConfigChange(); });
  });

  form.addEventListener("submit", function (e) { e.preventDefault(); run(); });
  $("resetBtn").addEventListener("click", function () {
    runToken++;
    setRunning(false);
    writeConfig(window.DEFAULT_CONFIG);
    setStatusPill("idle", "Очікування запуску");
  });
  $("loadScenarioBtn").addEventListener("click", function () {
    writeConfig(window.SCENARIOS[Number(select.value)].config);
  });
  $("compareBtn").addEventListener("click", compareAll);

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var rows = $("resultsBody").querySelectorAll("tr").length;
      drawChart(lastResult, lastResult ? Math.min(rows, lastResult.simulationDuration) : 0);
    }, 150);
  });

  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) { new bootstrap.Tooltip(el); });

  writeConfig(window.DEFAULT_CONFIG);
  drawChart(null, 0);
})();

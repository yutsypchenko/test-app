/*
 * Ядро симуляції. Не залежить від DOM, HTML чи Bootstrap.
 * Детермінована модель: запити надходять через рівні проміжки часу,
 * обслуговуються за принципом FIFO найпершим вільним виконавцем.
 * Час рахується в цілих мікросекундах, щоб уникнути похибок округлення.
 */
(function (global) {
  "use strict";

  var US = 1e6;
  var QUEUE_SAMPLE_US = 100000;

  function simulate(config) {
    var requestRate = Number(config.requestRate);
    var processingTime = Number(config.processingTime);
    var workers = Math.floor(Number(config.workers));
    var duration = Math.floor(Number(config.duration));
    var initialQueue = Math.floor(Number(config.initialQueue) || 0);

    var durationUs = duration * US;
    var procUs = Math.round(processingTime * 1000);
    var systemCapacity = workers / (processingTime / 1000);

    var arrivals = [];
    for (var q = 0; q < initialQueue; q++) arrivals.push(0);
    var incoming = Math.floor(requestRate * duration + 1e-9);
    for (var i = 0; i < incoming; i++) {
      arrivals.push(Math.round((i * US) / requestRate));
    }

    var total = arrivals.length;
    var starts = new Array(total);
    var freeAt = new Array(workers);
    for (var w = 0; w < workers; w++) freeAt[w] = 0;

    for (var r = 0; r < total; r++) {
      var best = 0;
      for (var k = 1; k < workers; k++) {
        if (freeAt[k] < freeAt[best]) best = k;
      }
      var start = Math.max(arrivals[r], freeAt[best]);
      starts[r] = start;
      freeAt[best] = start + procUs;
    }

    var intervals = [];
    for (var s = 0; s < duration; s++) {
      intervals.push({
        time: s + 1,
        newRequests: 0,
        processed: 0,
        queueLength: 0,
        waitSum: 0,
        waitCount: 0,
        waitingTime: 0,
      });
    }

    var processedRequests = 0;
    var busyUs = 0;
    var waitSumUs = 0;

    for (var j = 0; j < total; j++) {
      var a = arrivals[j];
      var st = starts[j];
      var end = st + procUs;

      if (j >= initialQueue) {
        var arrivalSlot = Math.min(duration - 1, Math.floor(a / US));
        intervals[arrivalSlot].newRequests++;
      }

      if (st <= durationUs) {
        var startSlot = Math.min(duration - 1, Math.max(0, Math.ceil(st / US) - 1));
        if (st === 0) startSlot = 0;
        intervals[startSlot].waitSum += st - a;
        intervals[startSlot].waitCount++;
        waitSumUs += st - a;
        busyUs += Math.min(end, durationUs) - st;
      } else {
        waitSumUs += durationUs - a;
      }

      if (end <= durationUs) {
        processedRequests++;
        var endSlot = Math.max(0, Math.ceil(end / US) - 1);
        intervals[endSlot].processed++;
      }
    }

    function queueAt(t) {
      var arrived = 0;
      var started = 0;
      for (var x = 0; x < total; x++) {
        if (arrivals[x] <= t) arrived++;
        else break;
      }
      for (var y = 0; y < total; y++) {
        if (starts[y] <= t) started++;
        else break;
      }
      return arrived - started;
    }

    var queueSamples = [];
    var ai = 0;
    var si = 0;
    var queueSum = 0;
    var maximumQueueLength = initialQueue > workers ? initialQueue - workers : 0;
    for (var t = 0; t <= durationUs; t += QUEUE_SAMPLE_US) {
      while (ai < total && arrivals[ai] <= t) ai++;
      while (si < total && starts[si] <= t) si++;
      var len = ai - si;
      queueSamples.push({ t: t / US, queue: len });
      queueSum += len;
      if (len > maximumQueueLength) maximumQueueLength = len;
    }

    for (var n = 0; n < duration; n++) {
      var iv = intervals[n];
      iv.queueLength = queueAt((n + 1) * US);
      iv.waitingTime = iv.waitCount ? iv.waitSum / iv.waitCount / 1000 : 0;
      delete iv.waitSum;
      delete iv.waitCount;
    }

    var remainingQueue = queueAt(durationUs);

    return {
      config: {
        requestRate: requestRate,
        processingTime: processingTime,
        workers: workers,
        duration: duration,
        initialQueue: initialQueue,
      },
      totalRequests: total,
      processedRequests: processedRequests,
      remainingQueue: remainingQueue,
      inProgress: total - processedRequests - remainingQueue,
      averageQueueLength: queueSum / queueSamples.length,
      maximumQueueLength: maximumQueueLength,
      averageWaitingTime: total ? waitSumUs / total / 1000 : 0,
      systemCapacity: systemCapacity,
      loadRatio: requestRate / systemCapacity,
      utilization: Math.min(100, (busyUs / (workers * durationUs)) * 100),
      simulationDuration: duration,
      intervals: intervals,
      queueSamples: queueSamples,
    };
  }

  function classifyLoad(ratio) {
    if (ratio < 0.85) return "stable";
    if (ratio <= 1.05) return "edge";
    return "overload";
  }

  function analyze(result) {
    var iv = result.intervals;
    var firstQueue = iv.length ? iv[0].queueLength : 0;
    var lastQueue = iv.length ? iv[iv.length - 1].queueLength : 0;
    var growing = lastQueue > firstQueue && result.remainingQueue > Math.max(1, result.totalRequests * 0.02);
    var pt = result.config.processingTime;

    if (growing) {
      return {
        status: "overload",
        title: "Перевантаження",
        text:
          "Навантаження перевищує пропускну здатність. Черга зростає (з " +
          firstQueue + " до " + lastQueue +
          " запитів), система не встигає обробляти запити. Середній час очікування — " +
          result.averageWaitingTime.toFixed(0) + " мс.",
      };
    }
    if (result.utilization >= 85 || result.averageWaitingTime > pt * 0.5 || result.remainingQueue > 0) {
      return {
        status: "edge",
        title: "Робота на межі",
        text:
          "Навантаження наближається до пропускної здатності. Завантаженість становить " +
          result.utilization.toFixed(1) +
          "%, система працює на межі, можливе збільшення часу очікування при найменшому зростанні потоку.",
      };
    }
    return {
      status: "stable",
      title: "Стабільна робота",
      text:
        "Навантаження нижче пропускної здатності системи. Черга не накопичується, система працює стабільно (завантаженість " +
        result.utilization.toFixed(1) + "%).",
    };
  }

  var api = { simulate: simulate, analyze: analyze, classifyLoad: classifyLoad };
  global.QueueSim = api;
  global.simulate = simulate;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

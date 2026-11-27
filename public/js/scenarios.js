(function (global) {
  "use strict";

  global.DEFAULT_CONFIG = {
    requestRate: 10,
    processingTime: 200,
    workers: 2,
    duration: 10,
    initialQueue: 0,
  };

  global.SCENARIOS = [
    {
      id: "low",
      name: "Сценарій 1 — Низьке навантаження",
      short: "Низьке",
      expected: "Система обробляє запити без значного накопичення черги.",
      config: { requestRate: 5, processingTime: 200, workers: 2, duration: 10, initialQueue: 0 },
    },
    {
      id: "edge",
      name: "Сценарій 2 — Навантаження на межі",
      short: "На межі",
      expected: "Система працює на межі місткості. Можливі невеликі коливання черги та часу очікування.",
      config: { requestRate: 10, processingTime: 200, workers: 2, duration: 10, initialQueue: 0 },
    },
    {
      id: "overload",
      name: "Сценарій 3 — Перевантаження",
      short: "Перевантаження",
      expected: "Черга зростає, час очікування збільшується, система не встигає обробити всі запити.",
      config: { requestRate: 20, processingTime: 200, workers: 2, duration: 10, initialQueue: 0 },
    },
  ];
})(window);

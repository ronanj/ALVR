define([
    "text!app/templates/statistics.html",
    "json!../../api/session/load",
    "lib/lodash",
    "i18n!app/nls/statistics",
    "css!app/templates/monitor.css",
    // eslint-disable-next-line requirejs/no-js-extension
    "js/lib/uPlot.iife.min.js",
    "css!js/lib/uPlot.min.css",
    "js/app/util.js",
], function (
    statisticsTemplate,
    session,
    _,
    i18n,
) {
    return function (alvrSettings) {
        let latencyGraph;
        let framerateGraph;

        function init() {
            let compiledTemplate = _.template(statisticsTemplate);
            const template = compiledTemplate(i18n);

            $("#statistics").append(template);

            $(document).ready(() => {
                initPerformanceGraphs();
            });

            setInterval(fillPerformanceGraphs, 31);
        }

        function handleJson(json) {
            switch (json.id) {
                case "Statistics":
                    updateStatistics(json.data);
                    break;
                case "GraphStatistics":
                    updateGraphStatistics(json.data);
                    break;
                case "SessionUpdated":
                    updateSession();
                    break;
                default:
                    break;
            }
        }

        function legendAsTooltipPlugin({
            className,
            style = {
                backgroundColor: "rgba(255, 249, 196, 0.92)",
                color: "black",
                fontFamily:
                    'Lato,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol"',
                fontSize: "80%",
                lineHeight: "1",
            },
        } = {}) {
            let legendEl;

            function init(u, opts) {
                legendEl = u.root.querySelector(".u-legend");

                legendEl.classList.remove("u-inline");
                className && legendEl.classList.add(className);

                uPlot.assign(legendEl.style, {
                    textAlign: "left",
                    pointerEvents: "none",
                    display: "none",
                    position: "absolute",
                    left: 0,
                    top: 0,
                    zIndex: 100,
                    boxShadow: "2px 2px 10px rgba(0,0,0,0.5)",
                    ...style,
                });

                const labels = legendEl.querySelectorAll(".u-label");

                for (let i = 0; i < labels.length; i++) labels[i].style.fontWeight = "700";

                const values = legendEl.querySelectorAll(".u-value");

                for (let i = 0; i < values.length; i++) values[i].style.fontWeight = "700";

                // hide series color markers
                //const idents = legendEl.querySelectorAll(".u-marker");

                //for (let i = 0; i < idents.length; i++)
                //idents[i].style.display = "none";

                const overEl = u.over;
                overEl.style.overflow = "visible";

                // move legend into plot bounds
                overEl.appendChild(legendEl);

                // show/hide tooltip on enter/exit
                overEl.addEventListener("mouseenter", () => {
                    legendEl.style.display = null;
                });
                overEl.addEventListener("mouseleave", () => {
                    legendEl.style.display = "none";
                });

                // let tooltip exit plot
                //    overEl.style.overflow = "visible";
            }

            function update(u) {
                const { left, top } = u.cursor;
                legendEl.style.transform = "translate(" + left + "px, " + top + "px)";
            }

            return {
                hooks: {
                    init: init,
                    setCursor: update,
                },
            };
        }

        function stack(data, omit) {
            let data2 = [];
            let bands = [];
            let d0Len = data[0].length;
            let accum = Array(d0Len);

            for (let i = 0; i < d0Len; i++) accum[i] = 0;

            for (let i = 1; i < data.length; i++)
                data2.push(omit(i) ? data[i] : data[i].map((v, i) => (accum[i] += +v)));

            for (let i = 1; i < data.length; i++)
                !omit(i) &&
                    bands.push({
                        series: [data.findIndex((s, j) => j > i && !omit(j)), i],
                    });

            bands = bands.filter((b) => b.series[1] > -1);

            return {
                data: [data[0]].concat(data2),
                bands,
            };
        }

        function getStackedOpts(opts, data) {
            let stacked = stack(data, (i) => false);

            opts.bands = stacked.bands;

            // restack on toggle
            opts.hooks = {
                setSeries: [
                    (u, i) => {
                        let stacked = stack(data, (i) => !u.series[i].show);
                        u.delBand(null);
                        stacked.bands.forEach((b) => u.addBand(b));
                        u.setData(stacked.data);
                    },
                ],
            };

            return opts;
        }

        function getSharedOpts(opts) {
            opts.cursor = {
                drag: {
                    dist: 10,
                    uni: 20,
                },
                sync: {
                    key: "graph",
                    scales: ["x"],
                },
            };
            (opts.pxAlign = 0),
                (opts.ms = 1),
                (opts.pxSnap = false),
                (opts.plugins = [legendAsTooltipPlugin()]);
            opts.axes = [
                {
                    size: 20,
                    space: 40,
                    values: [
                        [1000, ":{ss}", null, null, null, null, null, null, 1],
                        [1, ":{ss}.{fff}", null, null, null, null, null, null, 1],
                    ],
                    grid: {
                        width: 1,
                    },
                    ticks: {
                        size: 0,
                    },
                },
                {
                    size: 30,
                    space: 20,
                    grid: {
                        width: 1,
                    },
                    ticks: {
                        size: 0,
                    },
                },
            ];
            return opts;
        }

        function getSeries(label, stroke, fill, data, postfix) {
            return {
                label: label,
                stroke: stroke,
                fill: fill,
                value: (u, v, si, i) => (data[si][i] || 0).toFixed(3) + postfix,
                spanGaps: false,
            };
        }

        function getThemedOpts(opts) {
            opts.axes[0].stroke = "#ffffff";
            opts.axes[0].grid.stroke = "#444444";
            opts.axes[0].ticks.stroke = "#444444";
            opts.axes[1].stroke = "#ffffff";
            opts.axes[1].grid.stroke = "#444444";
            opts.axes[1].ticks.stroke = "#444444";
            return opts;
        }

        function getLatencyGraphSize() {
            return {
                width: document.getElementById("statisticsCard").clientWidth,
                height: 160,
            };
        }

        function getFramerateGraphSize() {
            return {
                width: document.getElementById("statisticsCard").clientWidth,
                height: 100,
            };
        }

        let themeColor = $("input[name='theme']:checked").val();

        if (themeColor == "systemDefault") {
            if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
                themeColor = "darkly";
            } else {
                themeColor = "classic";
            }
        }

        const now = parseInt(new Date().getTime());

        const length = 1200;
        const duration = 10000;

        let latencyGraphData = [
            Array(length + 1).fill(now),
            ...Array(8)
                .fill(null)
                .map((x) => Array(length).fill(null)),
        ];

        latencyGraphData[0].shift();
        latencyGraphData[0].unshift(now - duration);

        // Network, Rendering, Idle, Transcode
        const graphColors = ["#7f7f7f", "#d62728", "#ff7f0e", "#1f77b4"];

        let latencyGraphOptions = {
            series: [
                {
                    label: i18n["performanceTotalLatency"],
                    value: (u, v, si, i) =>
                        (latencyGraphData[latencyGraphData.length - 1][i] || 0).toFixed(3) + " ms",
                },
                getSeries(
                    i18n["performanceGameRender"],
                    graphColors[1],
                    graphColors[1],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceServerCompositor"],
                    graphColors[1],
                    graphColors[1],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceEncode"],
                    graphColors[3],
                    graphColors[3],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceSend"],
                    graphColors[0],
                    graphColors[0],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceDecode"],
                    graphColors[3],
                    graphColors[3],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceClientCompositor"],
                    graphColors[1],
                    graphColors[1],
                    latencyGraphData,
                    " ms"
                ),
                getSeries(
                    i18n["performanceClientVsync"],
                    graphColors[2],
                    graphColors[2],
                    latencyGraphData,
                    " ms"
                ),
            ],
        };

        latencyGraphOptions = getSharedOpts(latencyGraphOptions);
        if (themeColor == "darkly") {
            latencyGraphOptions = getThemedOpts(latencyGraphOptions);
        }
        latencyGraphOptions = getStackedOpts(latencyGraphOptions, latencyGraphData);

        let framerateGraphData = [
            Array(length + 1).fill(now),
            Array(length).fill(null),
            Array(length).fill(null),
        ];

        framerateGraphData[0].shift();
        framerateGraphData[0].unshift(now - duration);

        let framerateGraphOptions = {
            series: [
                {
                    label: "---",
                    value: "",
                    show: false,
                },
                getSeries(
                    i18n["performanceServer"],
                    graphColors[3],
                    null,
                    framerateGraphData,
                    " FPS"
                ),
                getSeries(
                    i18n["performanceClient"],
                    graphColors[2],
                    null,
                    framerateGraphData,
                    " FPS"
                ),
            ],
        };

        framerateGraphOptions = getSharedOpts(framerateGraphOptions);
        if (themeColor == "darkly") {
            framerateGraphOptions = getThemedOpts(framerateGraphOptions);
        }

        function initPerformanceGraphs() {
            latencyGraph = new uPlot(
                latencyGraphOptions,
                latencyGraphData,
                document.getElementById("latencyGraphArea")
            );
            framerateGraph = new uPlot(
                framerateGraphOptions,
                framerateGraphData,
                document.getElementById("framerateGraphArea")
            );
        }

        let lastStatisticsUpdate = now;
        let lastGraphUpdate = now;
        let lastGraphRedraw = now;

        function updatePerformanceGraphs(time, statistics) {
            const now = parseInt(new Date().getTime());

            for (let i = 0; i < latencyGraphData.length; i++) {
                latencyGraphData[i].shift();
            }

            latencyGraphData[0].push(time);
            if (statistics.totalPipelineLatencyS < Infinity) {
                latencyGraphData[1].push(statistics.gameTimeS * 1000);
                latencyGraphData[2].push(statistics.serverCompositorS * 1000);
                latencyGraphData[3].push(statistics.encoderS * 1000);
                latencyGraphData[4].push(statistics.networkS * 1000);
                latencyGraphData[5].push(statistics.decoderS * 1000);
                latencyGraphData[6].push(statistics.clientCompositorS * 1000);
                latencyGraphData[7].push(statistics.vsyncQueueS * 1000);
                latencyGraphData[8].push(statistics.totalPipelineLatencyS * 1000);
            } else {
                for (let i = 1; i < latencyGraphData.length; i++) {
                    latencyGraphData[i].push(null);
                }
            }

            for (let i = 0; i < framerateGraphData.length; i++) {
                framerateGraphData[i].shift();
            }

            framerateGraphData[0].push(time);
            framerateGraphData[1].push(statistics.serverFps);
            framerateGraphData[2].push(statistics.clientFps);

            lastStatistics = statistics;
            lastGraphUpdate = now;
        }

        function redrawPerformanceGraphs(time) {
            const now = parseInt(new Date().getTime());

            if (now > lastGraphRedraw + 32) {
                latencyGraphData[0].pop();
                latencyGraphData[0].push(time);

                latencyGraphData[0].shift();
                latencyGraphData[0].unshift(time - duration);

                framerateGraphData[0].pop();
                framerateGraphData[0].push(time);

                framerateGraphData[0].shift();
                framerateGraphData[0].unshift(time - duration);

                const ldata = []
                    .concat(latencyGraphData[latencyGraphData.length - 1])
                    .filter((v, i) => latencyGraphData[0][i] > now - 10 * 1000)
                    .filter(Boolean);
                const lq1 = quantile(ldata, 0.25);
                const lq3 = quantile(ldata, 0.75);
                //const lq1 = 0;
                //const lq3 = quantile(ldata,0.5);
                latencyGraph.batch(() => {
                    latencyGraph.setScale("y", { min: 0, max: lq3 + (lq3 - lq1) * 3 });
                    //latencyGraph.setScale("y", {min: 0, max: lq3+(lq3-lq1)*1.5});
                    latencyGraph.setData(stack(latencyGraphData, (i) => false).data);
                });
                const fdata1 = []
                    .concat(framerateGraphData[1])
                    .filter((v, i) => latencyGraphData[0][i] > now - 10 * 1000)
                    .filter(Boolean);
                const fdata2 = []
                    .concat(framerateGraphData[2])
                    .filter((v, i) => latencyGraphData[0][i] > now - 10 * 1000)
                    .filter(Boolean);
                const fdata = fdata1.concat(fdata2);
                const fq1 = quantile(fdata, 0.25);
                const fq3 = quantile(fdata, 0.75);
                latencyGraph.batch(() => {
                    framerateGraph.setScale("y", {
                        min: fq1 - (fq3 - fq1) * 1.5,
                        max: fq3 + (fq3 - fq1) * 1.5,
                    });
                    framerateGraph.setData(framerateGraphData);
                });
                lastGraphRedraw = now;
            }
        }

        let lastStatistics = {};
        let statisticsUpdateStopped = true;
        let statisticsRedrawStopped = true;

        function fillPerformanceGraphs() {
            latencyGraph.setSize(getLatencyGraphSize());
            framerateGraph.setSize(getFramerateGraphSize());
            if (!statisticsRedrawStopped) {
                const now = parseInt(new Date().getTime());
                let time = now;
                if ((now - 32 > lastGraphRedraw) & (now - 1000 < lastStatisticsUpdate)) {
                    if (now - 100 > lastGraphUpdate) {
                        if (!statisticsUpdateStopped) {
                            statisticsUpdateStopped = true;
                            // lastStatistics.fill(null);
                            time = lastGraphUpdate + 20;
                            updatePerformanceGraphs(time, lastStatistics);
                        }
                    }
                    redrawPerformanceGraphs(time);
                } else if (now - 1000 > lastStatisticsUpdate) statisticsRedrawStopped = true;
            }
        }

        function updateStatistics(statistics) {
            for (const stat in statistics) {
                $("#statistic_" + stat).text(statistics[stat]);
            }
        }

        function updateGraphStatistics(statistics) {
            const now = parseInt(new Date().getTime());

            lastStatisticsUpdate = now;

            if (statisticsUpdateStopped) statisticsUpdateStopped = false;
            if (statisticsRedrawStopped) {
                updatePerformanceGraphs(now - 20, lastStatistics);
                statisticsRedrawStopped = false;
            }
            updatePerformanceGraphs(now, statistics);
            redrawPerformanceGraphs(now);
        }

        let isUpdating = false;

        function updateSession() {
            //ugly hack to avoid loop
            if (isUpdating) {
                return;
            }
            isUpdating = true;
            $.getJSON("api/session/load", function (newSession) {
                session = newSession;
                updateClients();
                alvrSettings.updateSession(session);
                isUpdating = false;
            });
        }

        init();
    };
});

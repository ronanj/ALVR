define([
    "jquery",
    "lib/bootstrap.bundle.min",
    "lib/lodash",
    "text!app/templates/main.html",
    "i18n!app/nls/main",
    "i18n!app/nls/notifications",
    "app/settings",
    "app/setupWizard",
    "text!app/templates/updatePopup.html",
    "app/connection",
    "app/statistics",
    "app/driverList",
    "app/uploadPreset",
    "app/languageSelector",
    "json!../../api/session/load",
    "text!../../api/version",
    "text!../../api/server-os",
    // eslint-disable-next-line requirejs/no-js-extension
    "js/lib/lobibox.min.js",
    "css!js/lib/lobibox.min.css",
], function (
    $,
    bootstrap,
    _,
    mainTemplate,
    i18n,
    i18nNotifications,
    Settings,
    SetupWizard,
    updatePopup,
    Connection,
    Statistics,
    driverList,
    uploadPreset,
    languageSelector,
    session,
    version,
    serverOs
) {
    $(function () {
        const compiledTemplate = _.template(mainTemplate);
        const template = compiledTemplate(i18n);

        let statistics = null;

        function checkForUpdate(settings, delay) {
            if (serverOs != "windows") {
                return;
            }

            session = settings.getSession();
            const updateType = session.sessionSettings.extra.updateChannel.variant;

            let url = "";
            if (updateType === "stable") {
                url = "https://api.github.com/repos/alvr-org/ALVR/releases/latest";
            } else if (updateType === "nightly") {
                url = "https://api.github.com/repos/alvr-org/ALVR-nightly/releases/latest";
            } else {
                return;
            }

            $.get(url, (data) => {
                if (data.tag_name === "v" + version) {
                    Lobibox.notify("success", {
                        size: "mini",
                        rounded: true,
                        delayIndicator: false,
                        sound: false,
                        iconSource: "fontAwesome",
                        msg: i18n.noNeedForUpdate,
                    });
                    return;
                }

                if (session.sessionSettings.extra.promptBeforeUpdate) {
                    Lobibox.notify("warning", {
                        size: "mini",
                        rounded: true,
                        delay: delay,
                        delayIndicator: delay !== -1,
                        sound: false,
                        iconSource: "fontAwesome",
                        msg: i18n.needUpdateClickForMore,
                        closable: true,
                        onClick: () => showUpdatePopupDialog(data),
                    });
                } else {
                    triggerUpdate(data);
                }
            });
        }

        function showUpdatePopupDialog(data) {
            const compiledTemplate = _.template(updatePopup);
            const template = compiledTemplate(i18n);
            $("#confirmModal").remove();
            $("body").append(template);

            const _data = data;
            // this call need const variable unless you want them overwriten by the next call.
            $(document).ready(() => {
                $("#releaseTitle").text(_data.name);
                $("#releaseNote").text(_data.body);

                $("#confirmModal").modal({
                    backdrop: "static",
                    keyboard: false,
                });
                $("#cancelUpdateButton").click(() => {
                    $("#confirmModal").modal("hide");
                    $("#confirmModal").remove();
                });
                $("#okUpdateButton").click(() => {
                    $("#confirmModal").modal("hide");
                    $("#confirmModal").remove();
                    triggerUpdate(_data);
                });
                $("#moreUpdateButton").click(() => {
                    $.ajax({
                        headers: {
                            Accept: "application/json",
                            "Content-Type": "application/json",
                        },
                        type: "POST",
                        url: "/api/open",
                        // eslint-disable-next-line xss/no-mixed-html
                        data: JSON.stringify(_data.html_url),
                        dataType: "JSON",
                    });
                });
            });
        }

        function triggerUpdate(data) {
            let url = "";
            let size = 0;
            data.assets.forEach((asset) => {
                if (asset.name.startsWith("ALVR_Installer")) {
                    url = asset.browser_download_url;
                    size = asset.size;
                }
            });
            if (url === "") {
                return;
            }

            $("#setupWizard").modal("hide");
            $("#bodyContent").hide();
            $("#updating").show();

            const elem = document.getElementById("progressBar");

            // Create WebSocket connection.
            const webSocket = new WebSocket("ws://" + window.location.host + "/api/events");

            $.ajax({
                type: "POST",
                url: "/api/update",
                contentType: "application/json;charset=UTF-8",
                data: JSON.stringify(url),
                success: function (res) {
                    if (res === "") {
                        console.log("Success");
                    } else {
                        console.log("Info: ", res);
                        webSocket.close();
                        $("#bodyContent").show();
                        $("#updating").hide();
                    }
                },
                error: function (res) {
                    console.log("Error: ", res);
                    webSocket.close();
                    $("#bodyContent").show();
                    $("#updating").hide();
                },
            });

            if (webSocket !== null && typeof webSocket !== undefined) {
                webSocket.onmessage = function (event) {
                    try {
                        const dataJSON = JSON.parse(event.data);
                        if (dataJSON.id === "UpdateDownloadedBytesCount") {
                            const BtoMB = 1.0 / (1024 * 1024);
                            const sizeMb = size * BtoMB;
                            const downloadProgress = (dataJSON.data * BtoMB).toFixed(2);
                            document.getElementById("downloadProgress").innerText =
                                downloadProgress + "MB" + " / " + sizeMb.toFixed(2) + "MB";
                            const progress = ((100.0 * dataJSON.data) / size).toFixed(2);
                            elem.style.width = progress + "%";
                            elem.innerText = progress + "%";
                        }
                    } catch (error) {
                        console.log("Error with message: ", event);
                        Lobibox.notify("error", {
                            rounded: true,
                            delay: -1,
                            delayIndicator: false,
                            sound: false,
                            position: "bottom left",
                            iconSource: "fontAwesome",
                            msg: error.stack,
                            closable: true,
                            messageHeight: 250,
                        });
                    }
                };
            }
        }

        function logInit() {
            const url = window.location.href;
            const arr = url.split("/");

            const log_listener = new WebSocket("ws://" + arr[2] + "/api/log");

            log_listener.onopen = (ev) => {
                console.log("Log listener started");
            };

            log_listener.onerror = (ev) => {
                console.log("Log error", ev);
            };

            log_listener.onclose = (ev) => {
                console.log("Log closed", ev);
                logInit();
            };

            log_listener.addEventListener("message", function (e) {
                addLogLine(e.data);
            });

            $("#_root_extra_notificationLevel-choice-").change((ev) => {
                initNotificationLevel();
            });
        }
        
        function initNotificationLevel() {
            const level = $("input[name='notificationLevel']:checked").val();

            switch (level) {
                case "error":
                    notificationLevels = ["[ERROR]"];
                    break;
                case "warning":
                    notificationLevels = ["[ERROR]", "[WARN]"];
                    break;
                case "info":
                    notificationLevels = ["[ERROR]", "[WARN]", "[INFO]"];
                    break;
                case "debug":
                    notificationLevels = ["[ERROR]", "[WARN]", "[INFO]", "[DEBUG]"];
                    break;
                default:
                    notificationLevels = [];
                    break;
            }
        }
        
        function addLogLine(line) {
            let idObject = undefined;

            console.log(line);

            const json_start_idx = line.indexOf("#{");
            const json_end_idx = line.indexOf("}#");
            if (json_start_idx != -1 && json_end_idx != -1) {
                idObject = line.substring(json_start_idx + 1, json_end_idx + 1);
            }

            const split = line.split(" ");
            line = line.replace(split[0] + " " + split[1], "");

            const skipWithoutId = $("#_root_extra_excludeNotificationsWithoutId").prop("checked");

            let addToTable = true;
            if (idObject !== undefined) {
                idObject = JSON.parse(idObject);

                statistics.handleJson(idObject);
                switch (idObject.id) {
                    case "Statistics":
                        addToTable = false;
                        break;
                    case "GraphStatistics":
                        addToTable = false;
                        break;
                    default:
                        line = idObject.id;
                        break;
                }
            }

            if (notificationLevels.includes(split[1].trim())) {
                if (!(skipWithoutId && idObject === undefined) && Lobibox.notify.list.length < 2) {
                    Lobibox.notify(getNotificationType(split[1]), {
                        size: "mini",
                        rounded: true,
                        delayIndicator: false,
                        sound: false,
                        position: "bottom left",
                        title: getI18nNotification(idObject, line, split[1]).title,
                        msg: getI18nNotification(idObject, line, split[1]).msg,
                    });
                }
            }

            if (addToTable) {
                const row = `<tr><td>${split[0]}</td><td>${
                    split[1]
                }</td><td>${line.trim()}</td></tr>`;
                $("#loggingTable").append(row);
                if ($("#loggingTable").children().length > 500) {
                    $("#loggingTable tr").first().remove();
                }
            }
        }
        
        function getI18nNotification(idObject, line, level) {
            if (idObject === undefined) {
                return { title: level, msg: line };
            } else {
                //TODO: line could contain additional info for the msg

                if (i18nNotifications[idObject.id + ".title"] !== undefined) {
                    return {
                        title: i18nNotifications[idObject.id + ".title"],
                        msg: i18nNotifications[idObject.id + ".msg"],
                    };
                } else {
                    console.log("Notification with additional info: ", idObject.id);
                    return { title: level, msg: idObject.id + ": " + line };
                }
            }
        }

        function getNotificationType(logSeverity) {
            switch (logSeverity.trim()) {
                case "[ERROR]":
                    return "error";
                case "[WARN]":
                    return "warning";
                case "[INFO]":
                    return "info";
                case "[DEBUG]":
                    return "default";
                default:
                    return "default";
            }
        }

        $("#bodyContent").append(template);
        $(document).ready(() => {
            $("#loading").remove();
            let settings = null;
            let wizard = null;
            let connection = null;
            let language = null;
            try {
                settings = new Settings();
                checkForUpdate(settings, -1);
                wizard = new SetupWizard(settings);
                connection = new Connection(settings);
                statistics = new Statistics(settings);
                language = new languageSelector(settings);
                logInit();
                initNotificationLevel();
            } catch (error) {
                Lobibox.notify("error", {
                    rounded: true,
                    delay: -1,
                    delayIndicator: false,
                    sound: false,
                    position: "bottom left",
                    iconSource: "fontAwesome",
                    msg: error.stack,
                    closable: true,
                    messageHeight: 250,
                });
            }

            // update the current language on startup
            const sessionLocale = session.locale;

            language.addLanguageSelector("localeSelector", sessionLocale);

            language.addLanguageSelector("localeSelectorV", sessionLocale);

            let storedLocale = localStorage.getItem("locale");
            if (sessionLocale !== storedLocale && sessionLocale !== "system") {
                storedLocale = sessionLocale;
                localStorage.setItem("locale", storedLocale);
                window.location.reload();
            }

            $("#bodyContent").fadeIn(function () {
                if (session.setupWizard) {
                    setTimeout(() => {
                        wizard.showWizard();
                    }, 500);
                }
            });

            $("#runSetupWizard").click(() => {
                wizard.showWizard();
            });

            $("#addFirewallRules").click(() => {
                $.get("api/firewall-rules/add", undefined, (res) => {
                    if (res == 0) {
                        Lobibox.notify("success", {
                            size: "mini",
                            rounded: true,
                            delayIndicator: false,
                            sound: false,
                            msg: i18n.firewallSuccess,
                        });
                    }
                });
            });

            $("#removeFirewallRules").click(() => {
                $.get("api/firewall-rules/remove", undefined, (res) => {
                    if (res == 0) {
                        Lobibox.notify("success", {
                            size: "mini",
                            rounded: true,
                            delayIndicator: false,
                            sound: false,
                            msg: i18n.firewallSuccess,
                        });
                    }
                });
            });

            $("#checkForUpdates").click(() => {
                checkForUpdate(settings, 5000);
            });

            $("#version").text("v" + version);

            $("#openReleasePage").click(() => {
                let repoName = "";
                if (version.includes("nightly")) {
                    repoName = "ALVR-nightly";
                } else {
                    repoName = "ALVR";
                }
                const url = `https://github.com/alvr-org/${repoName}/releases/tag/v${version}`;
                $.ajax({
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                    type: "POST",
                    url: "/api/open",
                    // eslint-disable-next-line xss/no-mixed-html
                    data: JSON.stringify(url),
                    dataType: "JSON",
                });
            });

            driverList.fillDriverList("registeredDriversInst");

            uploadPreset.addUploadPreset("settingUploadPreset", settings.getWebClientId());

            document.title = `ALVR dashboard (server v${version})`;
        });
    });
});

define([
    "text!app/templates/addClientModal.html",
    "text!app/templates/configureClientModal.html",
    "text!app/templates/connection.html",
    "json!../../api/session/load",
    "lib/lodash",
    "i18n!app/nls/main",
    "css!app/templates/monitor.css",
], function (
    addClientModalTemplate,
    configureClientModalTemplate,
    connectionTemplate,
    session,
    _,
    i18n,
) {
    return function () {
        function init() {
            let compiledTemplate = _.template(connectionTemplate);
            const template = compiledTemplate(i18n);

            compiledTemplate = _.template(addClientModalTemplate);
            const templateAddClient = compiledTemplate(i18n);

            $("#connection").append(template);

            $(document).ready(() => {
                initAddClientModal(templateAddClient);

                updateClients();
            });
        }

        function updateClients() {
            $("#newClientsDiv" + " table").empty();
            $("#trustedClientsDiv" + " table").empty();

            Object.entries(session.clientConnections).forEach((pair) => {
                const hostname = pair[0];
                const connection = pair[1];
                const displayName = connection.displayName;

                if (connection.trusted) {
                    addTrustedClient(displayName, hostname);
                } else {
                    addNewClient(displayName, hostname);
                }
            });
        }

        function initAddClientModal(template) {
            $("#showAddClientModal").click(() => {
                $("#addClientModal").remove();
                $("body").append(template);
                $(document).ready(() => {
                    $("#addClientModal").modal({
                        backdrop: "static",
                        keyboard: false,
                    });
                    $("#clientAddButton").click(() => {
                        const deviceName = $("#deviceName").val();
                        const clientHostname = $("#clientHostname").val();
                        const ip = $("#clientIP").val();

                        if (!validateHostname(clientHostname)) {
                            Lobibox.notify("error", {
                                size: "mini",
                                rounded: true,
                                delayIndicator: false,
                                sound: false,
                                position: "bottom right",
                                msg: i18n["error_DuplicateHostname"],
                            });
                            return;
                        }

                        if (!validateIPv4address(ip)) {
                            Lobibox.notify("error", {
                                size: "mini",
                                rounded: true,
                                delayIndicator: false,
                                sound: false,
                                position: "bottom right",
                                msg: i18n["error_InvalidIp"],
                            });
                            return;
                        }

                        $.ajax({
                            type: "POST",
                            url: "api/client/add",
                            contentType: "application/json;charset=UTF-8",
                            data: JSON.stringify([deviceName, clientHostname, ip]),
                        });

                        $("#addClientModal").modal("hide");
                        $("#addClientModal").remove();
                    });
                });
            });
        }

        function initConfigureClientModal(hostname) {
            const id = hostname.replace(/\./g, "");
            $("#btnConfigureClient_" + id).click(() => {
                compiledTemplate = _.template(configureClientModalTemplate);
                templateConfigureClient = compiledTemplate({
                    i18n: i18n,
                    knownIps: session.clientConnections[hostname].manualIps,
                });

                $("#configureClientModal").remove();
                $("body").append(templateConfigureClient);

                const _hostmane = hostname;
                // this call need const variable unless you want them overwriten by the next call.
                $(document).ready(() => {
                    $("#configureClientModal").modal({
                        backdrop: "static",
                        keyboard: false,
                    });

                    $("#addNewIpAddressButton").click(() => {
                        const ip = $("#newIpAddress").val();

                        if (session.clientConnections[_hostmane].manualIps.includes(ip)) {
                            Lobibox.notify("error", {
                                size: "mini",
                                rounded: true,
                                delayIndicator: false,
                                sound: false,
                                position: "bottom right",
                                msg: i18n["error_DuplicateIp"],
                            });
                            return;
                        }

                        if (!validateIPv4address(ip)) {
                            Lobibox.notify("error", {
                                size: "mini",
                                rounded: true,
                                delayIndicator: false,
                                sound: false,
                                position: "bottom right",
                                msg: i18n["error_InvalidIp"],
                            });
                            return;
                        }

                        $.ajax({
                            type: "POST",
                            url: "api/client/trust",
                            contentType: "application/json;charset=UTF-8",
                            data: JSON.stringify([_hostmane, ip]),
                        });

                        $("#knowIpsListDiv").append(`
                            <div class="row mt-2"><div class="col">
                                <span>${ip}</span>
                                <button type="button" class="btn btn-sm btn-primary float-right removeIpAddressButton" data-ip="${ip}">${i18n["configureClientRemoveIp"]}</button>
                            </div></div>`);
                        configureClientModal_BindRemoveIpButtons(_hostmane);
                    });

                    configureClientModal_BindRemoveIpButtons(_hostmane);
                });
            });
        }

        function configureClientModal_BindRemoveIpButtons(hostname) {
            $(".removeIpAddressButton").off("click");
            $(".removeIpAddressButton").click((evt) => {
                const ip = $(evt.target).attr("data-ip");

                $.ajax({
                    type: "POST",
                    url: "api/client/remove",
                    contentType: "application/json;charset=UTF-8",
                    data: JSON.stringify([hostname, ip]),
                });

                $(evt.target).parent().parent().remove();
            });
        }

        function addNewClient(displayName, hostname) {
            if (!validateHostname(hostname)) return;

            const id = hostname.replace(/\./g, "");

            $("#newClientsDiv" + " table")
                .append(`<tr><td type="${displayName}" hostname="${hostname}" id="newClient_${id}">${displayName} (${hostname}) </td>
            <td><button type="button" id="btnAddTrustedClient_${id}" class="btn btn-primary">${i18n["addTrustedClient"]}</button>
            </td></tr>`);

            const _hostmane = hostname;
            // this call need const variable unless you want them overwriten by the next call.
            $(document).ready(() => {
                $("#btnAddTrustedClient_" + id).click(() => {
                    $.ajax({
                        type: "POST",
                        url: "api/client/trust",
                        contentType: "application/json;charset=UTF-8",
                        data: JSON.stringify([_hostmane, null]),
                    });
                });
            });
        }

        function addTrustedClient(displayName, hostname) {
            if (!validateHostname(hostname)) return;

            const id = hostname.replace(/\./g, "");

            $("#trustedClientsDiv" + " table")
                .append(`<tr><td type="${displayName}" hostname="${hostname}" id="trustedClient_${id}">${displayName} (${hostname}) </td>
            <td><button type="button" id="btnConfigureClient_${id}" class="btn btn-primary ml-auto">${i18n["configureClientButton"]}</button>
            <button type="button" id="btnRemoveTrustedClient_${id}" class="btn btn-primary">${i18n["removeTrustedClient"]}</button>
            </td></tr>`);

            const _hostmane = hostname;
            // this call need const variable unless you want them overwriten by the next call.
            $(document).ready(() => {
                $("#btnRemoveTrustedClient_" + id).click(() => {
                    $.ajax({
                        type: "POST",
                        url: "api/client/remove",
                        contentType: "application/json;charset=UTF-8",
                        data: JSON.stringify([_hostmane, null]),
                    });
                });
            });

            initConfigureClientModal(hostname);
        }

        function validateHostname(hostname) {
            const id = hostname.replace(/\./g, "");

            if ($("#newClient_" + id).length > 0) {
                console.warn("Client already in new list:", hostname);
                return false;
            }

            if ($("#trustedClient_" + id).length > 0) {
                console.warn("Client already in trusted list:", hostname);
                return false;
            }
            return true;
        }

        function validateIPv4address(ipaddress) {
            if (
                /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
                    ipaddress
                )
            ) {
                return true;
            }
            console.warn("The IP address is invalid.");
            return false;
        }

        init();
    };
});

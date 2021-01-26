'use strict';
const fs = require('fs');
const fs_async = require('fs').promises;
const targz = require('targz');
const getDate = require('../tools').getDate;
const path = require('path');
const axios = require('axios').default;
const fse = require('fs-extra');


async function getData(options, log, dashboardDir, datasourceDir, dashboardManuallyDir) {
    return new Promise(async (resolve, reject) => {

        // Load datasource
        try {
            const dataSourcesRequest = await axios({
                method: 'get',
                baseURL: `http://${options.host}:${options.port}`,
                url: '/api/datasources',
                auth: {
                    'username': options.username,
                    'password': options.pass
                },
                responseType: 'json'
            });

            await Promise.all(dataSourcesRequest.data.map(async (dataSource) => {
                await fs_async.writeFile(`${datasourceDir}/${dataSource.name}.json`, JSON.stringify(dataSource, null, 2));
            }));
        } catch (err) {
            log.debug('Error on Grafana Datasource Request');
        }

        // Load Dashboards
        try {
            const dashBoardsRequest = await axios({
                method: 'get',
                baseURL: `http://${options.host}:${options.port}`,
                url: '/api/search',
                headers: { 'Authorization': 'Bearer ' + options.apiKey },
                responseType: 'json'
            });

            let dashBoards = [];

            await Promise.all(dashBoardsRequest.data.map(async (dashBoard) => {
                if (dashBoards.indexOf(dashBoard.uri) === -1) {
                    dashBoards.push(dashBoard.uri);
                }
            }));

            await Promise.all(dashBoards.map(async (dashBoard) => {
                let dashBoardRequest = await axios({
                    method: 'get',
                    baseURL: `http://${options.host}:${options.port}`,
                    url: `/api/dashboards/${dashBoard}`,
                    headers: { 'Authorization': 'Bearer ' + options.apiKey },
                    responseType: 'json'
                });

                let dashBoardName = dashBoard.split('/').pop();
                log.debug('found Dashboard: ' + dashBoardName)

                const changedJSON = dashBoardRequest.data;

                delete changedJSON["meta"];
                changedJSON.dashboard.id = null;
                changedJSON.overwrite = true;
                
                let manuellyJSON = dashBoardRequest.data.dashboard;

                manuellyJSON.id = null;

                fs_async.writeFile(`${dashboardDir}/${dashBoardName}.json`, JSON.stringify(changedJSON, null, 2));
                //fs_async.writeFile(`${dashboardDir}/${dashBoardName}.json`, `{ "dashboard": ${JSON.stringify(json)}, "overwrite": true }`);
                fs_async.writeFile(`${dashboardManuallyDir}/${dashBoardName}.json`, JSON.stringify(manuellyJSON, null, 2));
            }));
        } catch (err) {
            log.debug('Error on Grafana Dashoard Request: ' + err);
        }
        // request finish
        resolve();
    });
}

async function command(options, log, callback) {

    const tmpDir = path.join(options.backupDir, 'grafana_tmp').replace(/\\/g, '/');
    const dashboardDir = path.join(tmpDir, 'dashboards').replace(/\\/g, '/');
    const datasourceDir = path.join(tmpDir, 'datasource').replace(/\\/g, '/');
    const dashboardManuallyDir = path.join(tmpDir, 'dashboards_manually_restore').replace(/\\/g, '/');

    log.debug('Start Grafana Backup ...');

    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir);
        log.debug('Created grafana_tmp directory');
    } else {
        log.debug(`Try deleting the old grafana_tmp directory: "${tmpDir}"`);
        fse.removeSync(tmpDir);
        if (!fs.existsSync(tmpDir)) {
            log.debug(`old grafana_tmp directory "${tmpDir}" successfully deleted`);
            fs.mkdirSync(tmpDir);
            log.debug('Created grafana_tmp directory');
        }
    }

    if (!fs.existsSync(dashboardDir)) {
        fs.mkdirSync(dashboardDir);
        log.debug('Created dashboard directory');
    }
    if (!fs.existsSync(dashboardManuallyDir)) {
        fs.mkdirSync(dashboardManuallyDir);
        log.debug('Created dashboards_manually_restore directory');
    }

    if (!fs.existsSync(datasourceDir)) {
        fs.mkdirSync(datasourceDir);
        log.debug('Created datasource directory');
    }

    if (fs.existsSync(tmpDir) && fs.existsSync(datasourceDir) && fs.existsSync(dashboardDir)) {

        try {
            log.debug('start Grafana request ...');
            await getData(options, log, dashboardDir, datasourceDir, dashboardManuallyDir);
            log.debug('start Grafana backup compress ...');

            // compress Backup
            try {
                const fileName = path.join(options.backupDir, `grafana_${getDate()}_backupiobroker.tar.gz`);

                options.context.fileNames.push(fileName);

                targz.compress({
                    src: tmpDir,
                    dest: fileName,
                }, (err, stdout, stderr) => {

                    if (err) {
                        options.context.errors.grafana = err.toString();
                        stderr && log.error(stderr);
                        if (callback) {
                            callback(err, stderr);
                            callback = null;
                        }
                    } else {
                        log.debug(`Backup created: ${fileName}`)
                        options.context.done.push('grafana');
                        options.context.types.push('grafana');
                        if (callback) {
                            try {
                                log.debug(`Try deleting the Grafana tmp directory: "${tmpDir}"`);
                                fse.removeSync(tmpDir);
                                if (!fs.existsSync(tmpDir)) {
                                    log.debug(`Grafana tmp directory "${tmpDir}" successfully deleted`);
                                }
                            } catch (err) {
                                log.debug(`Grafana tmp directory "${tmpDir}" cannot deleted ... ${err}`);
                            }
                            callback(null, stdout);
                            callback = null;
                        }
                    }
                });
            } catch (e) {
                log.debug(`Grafana Backup cannot created: ${e}`);
                try {
                    log.debug(`Try deleting the Grafana tmp directory: "${tmpDir}"`);
                    fse.removeSync(tmpDir);
                    if (!fs.existsSync(tmpDir)) {
                        log.debug(`Grafana tmp directory "${tmpDir}" successfully deleted`);
                    }
                } catch (err) {
                    log.debug(`Grafana tmp directory "${tmpDir}" cannot deleted ... ${err}`);
                }
                callback(null, e);
                callback = null;
            }
        } catch (e) {
            try {
                log.debug(`Try deleting the Grafana tmp directory: "${tmpDir}"`);
                fse.removeSync(tmpDir);
                if (!fs.existsSync(tmpDir)) {
                    log.debug(`Grafana tmp directory "${tmpDir}" successfully deleted`);
                }
            } catch (err) {
                log.debug(`Grafana tmp directory "${tmpDir}" cannot deleted ... ${err}`);
            }
            log.debug(`Grafana Backup cannot created: ${e}`);
            callback(null, e);
            callback = null;
        }
    } else {
        log.debug('Grafana Backup cannot created ...');
        callback(null, 'done');
        callback = null;
    }
}

module.exports = {
    command,
    ignoreErrors: false
};
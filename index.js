const fs = require("fs");
const chokidar = require('chokidar');


module.exports = function (moin, _settings) {
    const logger = moin.getLogger("settings");
    let root = moin.joinPath(_settings.configFolder);
    let join = (service)=>require("path").join(root, service + ".json");

    let _watcher = new Map();
    let _ids = new Map();

    function getSettings(service) {
        let settings = service.getSettings();
        let file = join(service.getName());
        return new Promise(resolve=> {
            fs.stat(file, (err)=> {
                if (err) {
                    return resolve({settings, write: true});
                }
                try {
                    let s = JSON.parse(fs.readFileSync(file));
                    settings = Object.deepExtend(settings, s);
                    if (JSON.stringify(settings) != JSON.stringify(s)) {
                        logger.info(`saving settings file ${file}`);
                        resolve({settings, write: true});
                    } else {
                        resolve({settings, write: false});
                    }
                } catch (e) {
                    logger.error(`settings file ${file} seems to be corrupt`);
                    resolve({settings, write: false});
                }

            });
        });
    }

    function prepareFolder() {
        return new Promise((resolve, reject)=> {
            fs.stat(root, (err, stat)=> {
                if (err) {
                    fs.mkdir(root, (err)=> {
                        resolve();
                    })
                } else {
                    resolve();
                }
            })
        });
    }


    moin.on("unloadService", (id)=> {
        if (_ids.has(id)) {
            if (_watcher.has(_ids.get(id)))_watcher.delete(_ids.get(id));
            _ids.delete(id);
        }
    });
    moin.on("loadService", (handler)=> {
        let file = join(handler.getService().getName());

        return getSettings(handler.getService()).then(({settings,write})=> {
            return (new Promise(resolve=> {
                handler.addApi("getSettings", ()=> {
                    return Object.assign({}, settings);
                });
                if (write) {
                    fs.writeFile(file, JSON.stringify(settings, null, 2), resolve);
                } else {
                    resolve();
                }
            }))
        }).then(()=> {
            setTimeout(()=> {
                _watcher.set(file, {id: handler.getId(), name: handler.getService().getName(), loaded: true});
                _ids.set(handler.getId(), file);
            }, 1000);
        });
    });

    moin.on("beforeServiceLoad", function ({ service, cancel}) {
        return getSettings(service).then(({settings})=> {
            if (!settings.active) {
                let file = join(service.getName());
                _watcher.set(file, {loaded: false, name: service.getName(), path: service.getPath()});
                cancel();
            }
        });
    });


    return prepareFolder().then(()=> {
        let reload = (f)=> {
            if (_watcher.has(f)) {
                let h = _watcher.get(f);
                if (h.loaded) {
                    logger.info(`settings for service ${h.name} have changed. reloading...`);
                    moin.emit("serviceChanged", h.id);
                } else {
                    logger.debug(h);
                    _watcher.delete(f);
                    moin.loadService(h.path);
                }
            }
        };
        chokidar
            .watch(root)
            .on('change', reload)
            .on('add', reload)
            .on('unlink', reload);
    });

};
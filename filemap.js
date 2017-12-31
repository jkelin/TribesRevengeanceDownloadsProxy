var SSH = require('simple-ssh');

function execCommandOnServer(opts) {
    console.info('SSHing into', { ...opts, pass: undefined });
    const findCommand = `find ${opts.folder} -type f -printf "%s\\t%p\\n"`;

    const ssh = new SSH(opts);

    let all = '';

    return new Promise(function(resolve, reject) {
        console.info('Executing command for', opts.host, ':', findCommand)
        ssh.exec(findCommand, {
            exit: function(code, stdout, stderr) {
                console.info('SSH result is', `is code:${code}, stdout.len:${stdout.length}, stderr.len:${stderr.len} for`, opts.host);

                if(code === 0) {
                    resolve(stdout);
                } else {
                    reject(code);
                }
            }
        }).start();
        console.info('SSH executed for', opts.host);
    });
}

async function getFilesOnServer(opts) {
    const stdout = await execCommandOnServer(opts);

    console.info('Parsing stdout for', opts.host)
    let data = stdout.split('\n').map(x => x.split('\t'))
    .filter(x => x[0] && x[1])
    .map(x => ({
        length: x[0],
        path: x[1].replace(opts.folder, ''),
        isFolder: false
    }));
    console.info('Parsed stdout with', data.length, 'items for', opts.host)


    // data.forEach(x => x.pathSegments = x.path.split('/'));
    data.forEach(x => x.parentFolder = x.path.replace(/\/?[^\/]+$/, ''));
    console.info('Added parent folders to', opts.host)

    data.forEach(x => {
        let basePath = '';

        for (const segment of x.path.split('/')) {
            const parentPath = basePath += segment;
            let folder = data.find(y => y.path === parentPath);

            if (!folder) {
                folder = {
                    path: parentPath,
                    isFolder: true,
                    children: []
                };
                
                if (folder.path !== '') {
                    folder.parentFolder = folder.path.replace(/\/?[^\/]+$/, '')
                }
                
                data.push(folder);
                
                // console.log(x.path, parent.path, parent.path.replace(/\/?[^\/]+$/, ''))
            }

            basePath += '/';
        }
    })
    data.push({path: '', isFolder: true, children: []})
    console.info('Added folder entries to', opts.host, 'current length is', data.length)

    data.forEach(x => x.filename = x.path.split('/')[x.path.split('/').length - 1]);
    console.info('Added filenames to', opts.host)

    data.forEach(x => x.extension = x.filename.split('.')[x.path.split('.').length - 1]);
    console.info('Added extensions to', opts.host)

    data = data.filter(x => x.filename[0] !== '.');
    console.info('Removed hidden entires', opts.host, 'current length is', data.length)
    
    data.forEach(x => {
        let parent = data.find(y => y.isFolder && y.path === x.parentFolder);
        if(parent && parent.children.indexOf(x) < 0) {
            parent.children.push(x);
            // console.log(x.path || '-', x.parentFolder || '-', parent.path || '-', parent.parentFolder || '-')
        }
    })
    console.info('Added parents to', opts.host)

    data.forEach(x => x.url = opts.urlBase + x.path);
    console.info('Added urls to', opts.host)

    const map = {};
    data.forEach(x => map[x.path] = x)
    console.info('Converted into map', opts.host)

    return map;
}

function addCombinedFolder(finalMap, allFolderName, allowedExtensions) {
    console.info('Adding', allFolderName, 'combined folder with extensions', allowedExtensions);

    const allFolder = finalMap[allFolderName] || {
        path: allFolderName,
        isFolder: true,
        filename: allFolderName,
        children: []
    }

    for (const i in finalMap) {
        const item = finalMap[i];
        if (!item.isFolder && allowedExtensions.indexOf(item.extension) > -1 && allFolder.children.filter(x => x.filename === item.filename).length < 1) {
            const allItem = {...item, path: allFolderName + '/' + item.filename, parentFolder: allFolderName};

            if (!finalMap[allItem.path]) {
                finalMap[allItem.path] = allItem;
                allFolder.children.push(allItem);
            }
        }
    }

    if(!finalMap[allFolder.path]) {
        finalMap[allFolder.path] = allFolder;
    }
    
    if(finalMap[''].children.indexOf(allFolder) < 0) {
        finalMap[''].children.push(allFolder);
    }

    console.info('Added combined folder');
}

async function combineFileMaps(filestorePromise, ...cachePromises) {
    const [filestore, ...caches] = await Promise.all([filestorePromise, ...cachePromises]);
    console.info('Combining file maps')
    console.info(Object.keys(filestore).length, 'items in filestore', caches.map(c => Object.keys(c).length), 'items in caches')

    const finalMap = { ...filestore };

    for (const cache of caches) {
        for (const i in cache) {
            if(finalMap[i]) {
                if(!cache[i].isFolder) {
                    finalMap[i].url = cache[i].url;
                }
            } else {
                finalMap[i] = cache[i];
                
                if(finalMap[cache[i].parentFolder] && finalMap[cache[i].parentFolder].children.filter(y => y.path === i).length < 1) {
                    finalMap[cache[i].parentFolder].children.push(cache[i]); 
                }
            }
        }
    }
    console.info('Combined file maps')

    addCombinedFolder(finalMap, 'all', ['zip', 'rar', 'exe']);
    addCombinedFolder(finalMap, 'all_gamefiles', ['u', 'pkg', 'ini', 'tvm', 'mopp']);

    return finalMap;
}

let lastFileMap = undefined;

module.exports = {
    getFileMap: () => lastFileMap
}

async function updateFileMap() {
    console.info('Updating filemap');

    if(!process.env.STORE1_PASS) {
        throw new Error("STORE1_PASS not set");
    }

    const filestoreFileMap = getFilesOnServer({
        user: process.env.STORE1_USER || 'filesto1',
        host: process.env.STORE1_HOST || 'nlss3.a2hosting.com',
        port: process.env.STORE1_PORT || 7822,
        pass: process.env.STORE1_PASS,
        folder: process.env.STORE1_PATH || 'public_html/downloads/',
        urlBase: process.env.STORE1_URLBASE || 'https://filestore.tribesrevengeance.net/downloads/'
    });

    if(!process.env.STORE2_PASS) {
        throw new Error("STORE2_PASS not set");
    }

    const proxyFileMap = getFilesOnServer({
        user: process.env.STORE2_USER || 'root',
        host: process.env.STORE2_HOST || 'downloads.fireant.pw',
        port: process.env.STORE2_PORT || 22,
        pass: process.env.STORE2_PASS,
        folder: process.env.STORE2_PATH || '/Downloads/',
        urlBase: process.env.STORE2_URLBASE || 'https://downloads.tribesrevengeance.net/'
    });

    const commonFileMap = combineFileMaps(
        filestoreFileMap,
        proxyFileMap
    );

    let map;
    
    // if filemap already exists, keep that until the new one resolves
    if (lastFileMap) {
        map = await commonFileMap;
        lastFileMap = commonFileMap;
    } else {
        lastFileMap = commonFileMap;
        map = await commonFileMap;
    }

    console.info('Done updating filemap, have', Object.keys(map).length, 'items');
}

function handleUpdate() {
    updateFileMap()
    .catch(err => {
        console.error('Error updating filemap');
        console.error(err);
    })
}

handleUpdate();

setInterval(handleUpdate, 10 * 60 * 1000);
const express = require('express')
const filesize = require('filesize')
const exphbs  = require('express-handlebars');
const morgan = require('morgan')

const filemap = require('./filemap.js');

const app = express();
app.use(morgan('combined'))
app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

function generateBreadcrumbs(item) {
    let breadcrumbs = [];

    let breadCrumbPath = '/';

    breadcrumbs.push({
        title: '/',
        url: '/'
    })

    if (item.path) {
        for(const segment of item.path.split('/')){
            breadcrumbs.push({
                title: segment || '/',
                url: breadCrumbPath += segment + '/'
            })
        }
    }

    return breadcrumbs;
}

app.get('*', async (req, res) => {
    const filestore = await filemap.getFileMap();

    const pth = req.path.replace('%20', ' ').substring(1);

    const item = filestore[pth + '/index.html'] || filestore[pth.replace(/\/$/, '') + '/index.html'] || filestore[pth] || filestore[pth] || filestore[pth.replace(/\/$/, '')] || filestore[pth + '/'];

    if (item) {
        if (item.isFolder) {
            if(req.headers.accept === 'application/json') {
                res.json(item);
            } else {
                const itemData = {
                    ...item,
                    path: item.path || '/',
                    breadcrumbs: generateBreadcrumbs(item),
                    children: item.children.map(c => ({
                        ...c,
                        url: `/${c.path}`,
                        size: c.isFolder ? `${c.children.length} items` : filesize(c.length, {standard: "iec"}),
                        sortSize: c.isFolder ? -1 : c.length
                    })),
                };

                itemData.children.sort((a, b) => a.filename.localeCompare(b.filename));
                itemData.back = itemData.breadcrumbs.length > 1 && itemData.breadcrumbs[itemData.breadcrumbs.length - 2];
                itemData.numFiles = itemData.children.filter(c => !c.isFolder).length;
                itemData.numFolders = itemData.children.filter(c => c.isFolder).length;
                itemData.breadcrumbs = itemData.breadcrumbs.slice(1);

                res.render('listing', itemData);
            }
        } else {
            res.status(307).header('Location', item.url).send('Redirecting...');
        }
    } else {
        res.status(404).send('Not found');
    }
});


app.listen(process.env.PORT || 3000, () => console.log('Listening on port', process.env.PORT || 3000))
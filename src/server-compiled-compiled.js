'use strict';

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _bodyParser = require('body-parser');

var _bodyParser2 = _interopRequireDefault(_bodyParser);

var _expressSession = require('express-session');

var _expressSession2 = _interopRequireDefault(_expressSession);

var _user = require('./controllers/user');

var user = _interopRequireWildcard(_user);

var _tags = require('./controllers/tags');

var tags = _interopRequireWildcard(_tags);

var _picture = require('./controllers/picture');

var picture = _interopRequireWildcard(_picture);

var _interactions = require('./controllers/interactions');

var interactions = _interopRequireWildcard(_interactions);

var _admin = require('./controllers/admin');

var admin = _interopRequireWildcard(_admin);

var _credentials = require('./credentials');

var _credentials2 = _interopRequireDefault(_credentials);

var _expressJwt = require('express-jwt');

var _expressJwt2 = _interopRequireDefault(_expressJwt);

var _multer = require('multer');

var _multer2 = _interopRequireDefault(_multer);

var _socket = require('socket.io');

var _socket2 = _interopRequireDefault(_socket);

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

var _socketioJwt = require('socketio-jwt');

var _socketioJwt2 = _interopRequireDefault(_socketioJwt);

var _cors = require('cors');

var _cors2 = _interopRequireDefault(_cors);

function _interopRequireWildcard(obj) {
    if (obj && obj.__esModule) {
        return obj;
    } else {
        var newObj = {};if (obj != null) {
            for (var key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key];
            }
        }newObj.default = obj;return newObj;
    }
}

function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
}

var corsOptions = {
    origin: 'http://localhost:3000',
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}; // ************************************************************************** //
//                                                                            //
//                                                        :::      ::::::::   //
//   server.js                                          :+:      :+:    :+:   //
//                                                    +:+ +:+         +:+     //
//   By: opichou <opichou@student.42.fr>            +#+  +:+       +#+        //
//                                                +#+#+#+#+#+   +#+           //
//   Created: 2016/09/01 18:27:53 by opichou           #+#    #+#             //
//   Updated: 2016/09/29 18:27:53 by opichou          ###   ########.fr       //
//                                                                            //
// ************************************************************************** //

var app = require('express')();
var server = _http2.default.createServer(app);
var io = (0, _socket2.default)(server);
var upload = (0, _multer2.default)({ dest: __dirname + '/uploads' });

app.disable('X-Powered-By');
app.use((0, _cors2.default)());
app.use(require('cookie-parser')(_credentials2.default.cookieSecret));
app.use((0, _expressSession2.default)({
    resave: false,
    saveUninitialized: true,
    secret: _credentials2.default.cookieSecret
}));
app.set('port', process.env.PORT || 3001);
app.use(_express2.default.static(__dirname + '/public'));
app.use(_bodyParser2.default.json());
app.use(_bodyParser2.default.urlencoded({
    extended: true
}));
app.use((0, _expressJwt2.default)({ secret: _credentials2.default.jwtSecret }).unless({
    path: ['/login', '/retrieve_password', '/activate_account', '/user/new', '/protected', /^\/test/i] }));
io.use(_socketioJwt2.default.authorize({
    secret: _credentials2.default.jwtSecret,
    handshake: true
}));

//--ROUTES--/ />

app.get('/', function (req, res) {
    res.send("Welcome dude !!!");
});
app.get('/login', function (_, res) {
    return res.send("Login Page");
});
app.post('/login', user.userLogin);
app.get('/user', (0, _cors2.default)(corsOptions), user.viewAll);
app.put('/user', user.updateProfile);
app.post('/picture', upload.single('picture'), picture.uploadPicture);
app.post('/picture/delete', picture.deleteOne);
app.post('/user/new', user.create);
app.post('/user/update', user.updateProfile);
app.get('/tags', tags.tags);
app.post('/tags', tags.addTag);
app.get('/test/login/:login', user.checkLogin);
app.get('/test/email/:email', user.checkEmail);
app.get('/account/register', user.renderForm);
app.post('/account/change_password', user.changePassword);
app.post('/account/retrieve_password', user.retrievePassword);
app.post('/account/activate', user.isVerified);
app.post('/account/reactivate', user.reactivate);
app.post('/account/delete', user.Delete);
app.post('/admin/userform/', admin.addFormItems);
//--ROUTES--/ />

function now() {
    var currentDate = new Date();
    return currentDate.getDate() + "/" + ("0" + (currentDate.getMonth() + 1)).slice(-2) + "/" + currentDate.getFullYear() + " @ " + currentDate.getHours() + ":" + currentDate.getMinutes() + ":" + currentDate.getSeconds();
}

io.on('connection', function (socket) {
    interactions.connect(socket.decoded_token.username, socket.id);
    console.log(socket.decoded_token.username, 'connected on', now());
    setTimeout(function () {
        return socket.emit('message', {
            body: "Ceci est un message",
            from: socket.decoded_token.username,
            read: false
        });
    }, 500);
    setTimeout(function () {
        return socket.emit('match', {
            body: "ceci est un match",
            from: socket.decoded_token.username,
            read: false
        });
    }, 4000);
    setTimeout(function () {
        return socket.emit('message', {
            body: "Ceci est un message",
            from: socket.decoded_token.username,
            read: false
        });
    }, 8600);

    socket.on('message', function (body) {
        socket.emit('message', {
            body: body,
            from: socket.decoded_token.username,
            read: false
        });
    });
    socket.on('like', function (body) {
        socket.broadcast.emit('like', {
            body: body,
            from: socket.decoded_token.username,
            read: false
        });
    });
    socket.on('match', function (body) {
        socket.broadcast.emit('match', {
            body: body,
            from: socket.decoded_token.username,
            read: false
        });
    });
    socket.on('visit', function (body) {
        socket.emit('visit', {
            body: body,
            from: socket.decoded_token.username,
            read: false
        });
    });
    socket.on('disconnect', function () {
        interactions.disconnect(socket.decoded_token.username, socket.id);
        console.log(socket.decoded_token.username, 'disconnected on', now());
    });
});

app.use(function (err, req, res, next) {
    if (err.name === 'UnauthorizedError') {
        res.redirect('/login');
    }
});
app.use(function (req, res) {
    res.type('text/html');
    res.status(404);
    res.send('Error 404 Page');
});
app.use(function (err, req, res) {
    console.error(err.stack);
    res.status(500);
    res.send('Error 500 Page');
});
server.listen(app.get('port'), function () {
    console.log('Express started on http://localhost:' + app.get('port') + ' press Ctrl-C to terminate');
});

//# sourceMappingURL=server-compiled.js.map

//# sourceMappingURL=server-compiled-compiled.js.map
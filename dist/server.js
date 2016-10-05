// ************************************************************************** //
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

import express from 'express';
import http from 'http';
import fs from 'fs';
import parseurl from 'parseurl';
import bodyParser from 'body-parser';
import session from 'express-session';
import * as user from './controllers/user';
import * as picture from './controllers/picture';
import interactions from './controllers/interactions';
import * as admin from './controllers/admin';
import credentials from './credentials';
import nodemailer from 'nodemailer';
import expressJWT from 'express-jwt';
import multer from 'multer';
import socket from 'socket.io';
import path from 'path';
import webpack from 'webpack';
import webpackDevMiddleware from 'webpack-dev-middleware';
import webpackConfig from '../webpack.config.js';

const app = express();
const server = http.createServer(app);
const io = socket(server);
const upload = multer({ dest: `${ __dirname }/uploads` });

app.disable('X-Powerd-By');
app.use(require('cookie-parser')(credentials.cookieSecret));
app.use(session({
    resave: false,
    saveUninitialized: true,
    secret: credentials.cookieSecret

}));
app.set('port', process.env.PORT || 8081);
app.use(express.static(__dirname + '/public'));
app.use(webpackDevMiddleware(webpack(webpackConfig)));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(expressJWT({ secret: credentials.jwtSecret }).unless({
    path: ['/login', '/retrieve_password', '/activate_account', '/user/new', '/protected', /^\/test/i] }));

//--ROUTES--/ />

app.get('/', (req, res) => {
    res.send("Welcome dude !!!");
});
app.get('/login', (_, res) => res.send("Login Page"));
app.post('/login', user.userLogin);
app.get('/user', user.viewAll);
app.put('/user', user.updateProfile);
app.post('/picture', upload.single('picture'), picture.uploadPicture);
app.post('/picture/delete', picture.deleteOne);
app.post('/user/new', user.create);
app.post('/user/update', user.updateProfile);
app.get('/user/tags', user.tags);
app.post('/user/tags', user.addTag);
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

io.on('connection', socket => {
    socket.on('message', body => {
        socket.broadcast.emit('message', {
            body,
            from: socket.id.slice(8)
        });
    });
});

app.use((err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
        res.redirect('/login');
    }
});
app.use((req, res) => {
    res.type('text/html');
    res.status(404);
    res.send('Error 404 Page');
});
app.use((err, req, res) => {
    console.error(err.stack);
    res.status(500);
    res.send('Error 500 Page');
});
server.listen(app.get('port'), () => {
    console.log('Express started on http://localhost:' + app.get('port') + ' press Ctrl-C to terminate');
});
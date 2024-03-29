
import fs from 'fs'
import session from 'express-session'
import bcrypt from 'bcrypt-nodejs'
import * as dbl from "./dbConnect"
import credentials from '../credentials'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import ERROR from './errno_code'
import match from '../model/match'
import crypto from 'crypto'
import * as tags from './tags'
import chalk from 'chalk'

let saltRounds = 10

let transporter = nodemailer.createTransport('smtps://apimatcha@gmail.com:apiMatcha1212@smtp.gmail.com')


function now(){
    const currentDate = new Date();
    return currentDate.getDate() + "/"+ ("0" + (currentDate.getMonth() + 1)).slice(-2)
        + "/" + currentDate.getFullYear() + " @ "
        + currentDate.getHours() + ":"
        + currentDate.getMinutes() + ":" + currentDate.getSeconds()
}

const encrypt = async message => {
    let encrypted = await crypto.createHmac('sha256', credentials.cookieSecret)
        .update(message, 'utf8', 'hex')
        .digest('hex')
    return encrypted
}

const decrypt = async text => {
    let decipher = crypto.createDecipher('sha256', credentials.cookieSecret)
    let dec = decipher.update(text,'hex','utf8')
    dec += decipher.final('utf8');
    return dec;
}

async function genToken (user){
    let myToken = await jwt.sign({username: user.login}, credentials.jwtSecret)
    let db = await dbl.connect()
    try {
        const update = await db.collection('users').updateOne({login: user.login},{$set: {token: myToken}})
        if (update.modifiedCount == 1){
            user.token = myToken
            return user
        } else {
            console.error(ERROR.TOKEN_ERROR + user.login)
            user.success = false
            user.message = ERROR.TOKEN_ERROR
            return user;
        }
    } catch (err) {
        user.success = false
        user.message = ERROR.TOKEN_ERROR
        user.error = err
        user.password=''
        return user
    } finally {
        db.close();
    }
}

async function addFingerprint(user, fingerprint){
    let db = await dbl.connect()
    try {
        db.collection('users').updateOne({login: user.login}, {$push: {fingerprint: fingerprint}})
        user.fingerprint = fingerprint
        return user
    } catch (err) {
        console.error(err);
    }
}

function contains(a, obj) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] === obj) {
            return true;
        }
    }
    return false;
}

async function basicAuth(login, password, fingerprint, callback) {
    let err = ""
    let db = await dbl.connect();
    try {
        let user = await db.collection('users').findOne({
            $or: [{login: login, active: true}, {
                email: login,
                active: true
            }]
        })

            if (!user) {
                callback({success: false, message: "ta mere"}, {
                    auth: {
                        success: false,
                        message: ERROR.AUTH_ERROR
                    }
                });
            } else {
                const pass = await encrypt(password)
                if (user.password === pass) {
                    user = await genToken(user);
                    if (user.fingerprint && contains(user.fingerprint, fingerprint)) {
                        const ret = {
                            auth: {
                                method: "basic",
                                success: true,
                                fingerprint: fingerprint,
                                token: user.token,
                                message: ERROR.LOGIN_SUCCESS_INFO
                            }
                        };
                        callback(err, ret);
                    } else {
                        user = await addFingerprint(user, fingerprint)
                        const ret = {
                            auth: {
                                method: "basic",
                                success: true,
                                fingerprint: fingerprint,
                                token: user.token,
                                message: ERROR.LOGIN_SUCCESS_INFO
                            }
                        };
                        callback(err, ret)
                    }
                } else {
                    const ret = {
                        auth: {
                            method: "basic",
                            success: false,
                            fingerprint: fingerprint,
                            message: ERROR.AUTH_PASSWORD_ERROR
                        }
                    };
                    callback(err, ret);
                }
            }
        }
    catch (err) {
        callback(err, false);
    } finally {
        db.close()
    }
}

async function tokenAuth(token, fingerprint, callback){
    let db = await dbl.connect();
    let login = jwt.verify(token, credentials.jwtSecret).username
    try {
        let user = await db.collection('users').findOne({login: login, active : true});
        if (!user) {
            const ret = {
                auth:{
                    method: "token",
                    success: false,
                    fingerprint: fingerprint,
                    message: ERROR.AUTH_ERROR}};
            callback(true, ret);
        } else if (user.fingerprint && contains(user.fingerprint, fingerprint)){
            const ret = {
                auth:{
                    method: "token",
                    success: true,
                    fingerprint: fingerprint,
                    message: ERROR.LOGIN_SUCCESS_INFO}};
            callback(false, ret);
        } else {
            const ret = {
                auth:{
                    method: "token",
                    success: false,
                    fingerprint: false,
                    message: ERROR.AUTH_DEVICE_ERROR}};
            callback(true, ret);
        }
    }
    catch (err){
        const ret = {
            auth:{
                method: "token",
                success: false,
                fingerprint: fingerprint,
                message: ERROR.AUTH_ERROR}};
        callback(err, ret);
    } finally {
        db.close();
    }
}

export async function userLogin(req, res) {
    let token = ''
    if (req.headers.authorization) {
        token = req.headers.authorization.match(/^Bearer (.*)$/)[1]
    } else if (req.body.token) {
        token = req.body.token.match(/^Bearer (.*)$/)[1]
    }
    await authenticate(req.body.login, req.body.password, token, req.body.fingerprint, (err, ret) => {
            if (err || ret.auth.fingerprint == false) {
                ret.success = false
            }
        res.send(ret)
        }
    )
}

async function authenticate(login, password, token, fingerprint, callback){
    //This method authenticates user using basic strategy (username and password) or token based strategy.
    //The first strategy uses Bcrypt to hash and salt the password.
    //The latter uses JWT to validate the token.
    //In any case, if a token doesn't exist, one is generated upon authentication success.
    //After authenticating, if the device fingerprint isn't recognized, user will be required to confirm his identity
    // using email.
    //This function fires a callback when succeeding, this callback takes two arguments: err: boolean and ret: object
    // containing every info about the authentication and its eventual success, if such, user info and details about
    // device fingerprint status.

    console.log(chalk.yellow("Connection attempt from: " + login + ' (token: ' + token + ')'));
    if (login && password && fingerprint) {
        basicAuth(login, password, fingerprint, callback)
    } else if (token && fingerprint) {
        tokenAuth(token, fingerprint, callback)
    }else {
        callback({message: ERROR.AUTH_ERROR},
            {auth:{success: false, message: ERROR.AUTH_ERROR}});
    }
}

export async function checkLogin(req, res, next){
    try {
        let test = await checkLoginHlp(req.params.login);
        res.send(test);
    } catch(err) { next(err)}
}

async function checkLoginHlp(login){
    const routes = ['new', 'update', 'locate']
    if (routes[login] !== -1) {
        return {valid: false, message: "Login " + login + " isn't available", login: login}
    }
    let db = await dbl.connect();
    try {
        const collection = db.collection('users');
        let userCount = (await collection.find({
            login: login
        }).limit(1).count());
        if (userCount === 0 && !(/([ ])/.exec(login))) {
            return {valid: true, message: "Login " + login + " is available", login: login};
        } else if((/([ ])/.exec(login))){
            return {valid: false, message: "Login " + login + " contains whitespace", login: login};
        } else {
            return {valid: false, message: "Login " + login + " isn't available", login: login};
        }
    } finally {
        db.close();
    }
    //this method checks if Login already exists in database
}

async function checkEmailHlp(email){
    let db = await dbl.connect();
    try {
        let collection = db.collection('users');
        let userCount = (await collection.find({
            email: email
        }).limit(1).count());
        if (userCount == 0 && (email.match(/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/ig))) {
            return {valid: true, message: "Email " + email + " is available",email: email};
        } else if(userCount == 0){
            return {valid: false, error: 1, message: "Email " + email + " is incorrect",email: email};
        } else {
            return {valid: false, error: 2, message: "A profile already exists for " + email,email: email};
        }
    } finally {
        db.close();
    }
    //this method checks if Email already exists in database
}

export async function checkEmail(req, res){
    try {
        let test = await checkEmailHlp(req.params.email);
        res.send(test);
    } catch(err) { console.error(err)}
}

async function checkPass(pass1, pass2){
    if ((pass1 === pass2) &&
        (pass1.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,48}$/))){
        let password = await encrypt(pass1)
        return ({valid: true, message: "Valid password", password: password})
    } else {
        return({valid: false, message: ERROR.PASSWORD_FORMAT_ERROR})
    }
}

async function changePasswordHlp(token, password, res){
    jwt.verify(token, credentials.jwtSecret, async function(err, ret){
            if (err) {
                res.send({success: false, message: 'token has expired or is corrupted'})
            } else {
                let password2 = await encrypt(password)
                const email = ret.email
                const db = await dbl.connect()
                try {
                    let update = await db.collection('users').update({email: email}, {$set: {password: password2}})
                    if (update.result.ok === 1) {
                        res.send({success: true, message: "Password updated successfully"})

                    } else {
                        res.send({
                            success: false,
                            message: "An error happened while updating the password"
                        })
                    }
                } finally {
                    db.close()
                }
            }
    })
}

export async function changePassword(req, res) {
        try {
            let token = req.body.token
            if (req.body.password === req.body.password2) {
                const password = req.body.password
                await changePasswordHlp(token, password, res)
            }
        } catch (err) {
            console.log(err)
        }
}

async function requireNewPassword(email){
    //this methods sends an email with a temporary link for the user to create a new password
    let myToken = jwt.sign({email: email}, credentials.jwtSecret, {expiresIn: 900});
    const db = await dbl.connect();
    const user = await db.collection('users').findOne({email: email});
    try {
        if (!user || !user.login ) {
            return ({success: false, message: "User wasn't found"});
        } else {
            let mailOptions = {
                from: '"liveoption" <customer-success@liveoption.io>', // sender address
                to: email, // list of receivers
                subject: 'Password reset requested on liveoption',
                html: '<b>Hello,</b></br><p>A password recovery procedure has been requested ' +
                'in your name on liveoption.io. If you requested a new password, please' +
                ' click on the following link to proceed.</p>' +
                '<a href="http://localhost:8080/change-password?token=' + myToken + '">Change my password now</a>' +
                '<p>If you didn\'t request a password reset, please disregard this message</p>' // html body
            };
            await transporter.sendMail(mailOptions);
            return ({success: true, message: "Email sent"})
        }
    }catch (err) {
    } finally {
        db.close();
    }
}

export async function retrievePassword(req, res){
    let email = req.body.email;
    let response = await requireNewPassword(email, res);
    try {
        res.setHeader('Content-Type', 'application/json');
        res.send(response);
    } catch (err) {
    }
}

export async function Delete(req, res){
    login = req.body.login;
    password = req.body.password;
    fingerprint = req.body.fingerprint;
    let returnValue = null;
    //this methods allow deletion of a user account after validating password
    await authenticate(login, password, '', fingerprint, async (err, ret) => {
        //remove from database and callback to feedback user in the UI
        if (ret.auth.success){
            const db = await dbl.connect();
            const status = await db.collection('users').updateOne({login: "login"}, {$set: {active: false}});
            try{
                returnValue = status;
            } catch(err) {
                console.error(err);
                returnValue = {success: false, state: "error", message: ERROR.DELETE_ERROR};
            }finally {
                db.close();
            }

        }else{
            retrunValue = {success: false, state: "error", message: ERROR.DELETE_ERROR};
        }
    });
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(returnValue));
}

export async function renderForm(req, res){
    let db = await dbl.connect()
    let response = await db.collection('profileItems').find()
    try {
        res.send(response)
    } finally {
        db.close()
    }
}

export async function create(req, res){
    if (req.body.login && req.body.email && req.body.password && req.body.password2) {
        let user = {active: false},
            errors = [],
            emailProp = await checkEmailHlp(req.body.email),
            loginProp = await checkLoginHlp(req.body.login),
            passwordProp = await checkPass(req.body.password, req.body.password2)

        user.fingerprint = req.body.fingerprint

        if (emailProp.valid) {
            user.email = emailProp.email
        } else {
            errors.push(emailProp.message)
        }
        if (loginProp.valid) {
            user.login = loginProp.login
        } else {
            errors.push(loginProp.message)
        }
        if (passwordProp.valid) {
            user.password = passwordProp.password
        } else {
            errors.push(passwordProp.message)
        }
        if (errors.length === 0) {
            let db = await dbl.connect()
            try {
                const rep = await db.collection('users').insertOne(user);
                if (rep.insertedCount === 1) {
                    const email = await validateAccount(user.email);
                    console.log(chalk.blue(' New user created:' + user.login))
                    res.send({success: true, message: "User created, please check your emails"});
                }
            } finally {
                db.close();
            }
        } else {
            res.send({success: false, message: "Your account couldn't be created", errors: errors || ""})
        }
    } else {
        res.send({success: false, message: "Your account couldn't be created"})
    }
} //this method adds a new user to the database

export async function reactivate(req, res){
    let login = req.body.login,
        password = req.body.password,
        db = await dbl.connect();
    try {

        const user = await db.collection('users').findOneAndUpdate({login: login, password: password, active: false}, {$set: {active: true}})
        if (user.nModified != 1) {
            res.send({success: false, message: ERROR.REACTIVATION_ERROR})
        }else{
            let myToken = jwt.sign({email: user.email}, credentials.jwtSecret, {expiresIn: 9000}),
                mailOptions = {
                    from: '"liveoption" <customer-success@liveoption.io>', // sender address
                    to: user.email, // list of receivers
                    subject: 'Your account has been reactivated',
                    html: '<b>Hello,</b></br><p>Your liveoption account has just been reactivated.' +
                    'If you did not request the reactivation of your liveoption account, <a href="'+ req.get('host') +'/">please click here.</a></p>'+
                    '<p>Thank you,</p><p>See you soon !</p>'
                }; // html body
            res.send(await transporter.sendMail(mailOptions))
        }
    } finally {
        db.close()
    }
}//this method reactivates a previously desactivated account

async function validateAccount(email){
    let myToken = jwt.sign({email: email}, credentials.jwtSecret, {expiresIn: '7d'});
    let mailOptions = {
        from: '"liveoption" <customer-success@liveoption.io>', // sender address
        to: email, // list of receivers
        subject: 'Pleasee verify your liveoption account',
        html: '<b>Hello,</b></br><p>You just created a liveoption account. Please click the following link within the next 15mins. to verify your email address.</p>' +
        '<a href="http://localhost:3000/validate?token=' + myToken + '">Validate account now</a>' +
        '<p>Thank you for registering liveoption,</p><p>See you soon !</p>' // html body
    };
    return await transporter.sendMail(mailOptions);
}

export async function isVerified(req, res){
    //this method makes sure the user has authorized his account via email
    let email = req.user.email;
    let db = await dbl.connect();
    try{
        let result = await db.collection('users').findOneAndUpdate({email}, {$set: {active: true}});
            if (result.ok === 1) {
                let user = await genToken(result.value)
                 res.send({success: true, user})
            } else {
                res.send({success: false, message: ERROR.AUTH_ERROR})
            }
    } finally {
        db.close();
    }
}

export async function updateProfile(req, res){
    let db = await dbl.connect()
    try {
        let payload = req.body
        if (payload) {
            let login = req.user.username
            if (payload.tags) {await tags.addTag(payload.tags, db)}
            let results = await db.collection('users').update({login},{$set: {...payload}})
            res.send({success: true, message:ERROR.PROFILE_UPDATED_INFO})
        } else {
            res.send({success: false})
        }
    } catch(err) {
    } finally {
        db.close()
    }
}


export const isEnabled = async login => {
    let db = await dbl.connect()
    try {
        return await db.collection('users').findOne({login}, {photo: true}).photo.length != 0
    } catch (err) { console.error(err) }
    finally { db.close()
    }
}

export const locate = async (req, res) => {
    let db = await dbl.connect()
    const login = req.user.username,
        Lat = req.body.Lat,
        Lng = req.body.Lng
    try {
        let test = await db.collection('users').update({login}, {$set: {Lat, Lng}})
        if (test.nModified !== 0) {
            res.send({success: true, message: ERROR.GEOLOC_SUCCESS})
        } else {
            res.send({success: false, message: ERROR.GEOLOC_FAILURE})
        }
    } catch (err) {
        console.error(err)
    } finally {
        db.close()
    }
}

export const report = async (req, res) => {
    let userId = req.user.username
    let otherId = req.query.userId
    let mailOptions = {
        from: '"liveoption" <customer-success@liveoption.io>', // sender address
        to: 'olivierpichouparis@gmail.com', // list of receivers
        subject: 'Report on liveoption',
        html: '<b>Hello,</b></br><p>' + userId + 'wants to report ' + otherId + '</p>' // html body
    }
    return await transporter.sendMail(mailOptions);
}

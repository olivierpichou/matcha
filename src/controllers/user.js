/**
 * Created by opichou on 9/19/16.
 */
import express from 'express';
import formidable from 'formidable';
import fs from 'fs';
import parseurl from 'parseurl';
import bodyParser from 'body-parser';
import session from 'express-session';
import bcrypt from 'bcrypt';
import * as dbl from "./dbConnect";
import credentials from '../credentials';
import mongodb from 'mongodb';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import ERROR from './errno_code';
import match from '../model/match';
const saltRounds = 10;

let MongoClient = mongodb.MongoClient;
let transporter = nodemailer.createTransport('smtps://apimatcha@gmail.com:apiMatcha1212@smtp.gmail.com');


async function genToken(user){
    let myToken = jwt.sign({username: user.login}, credentials.jwtSecret);
    user.token = myToken;
    const db = await dbl.connect();
    try {
        const update = await db.collection('users').updateOne({login: user.login},{$set: {token: myToken}});
        try {
            if (update.modifiedCount == 1){
                return user;
            } else { console.log(ERROR.TOKEN_ERROR + user.login);}
        } catch (err) {
            console.log(err);
            return false;
        }
    } catch (err) {
        console.log(err);
            return false;
    } finally {
        db.close();
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

async function newDevice(userObj, callback){
    if (userObj.user.fingerprint) {
        userObj.user.fingerprint.push(userObj.auth.fingerprint);
    } else {
        userObj.user.fingerprint = [userObj.auth.fingerprint];
    }
    const db = await dbl.connect();
    try {
        const update = await db.collection('users').updateOne({login: userObj.user.login},
            {$set: {fingerprint: userObj.user.fingerprint}});
        try {
            if (update.modifiedCount == 1){
                callback(false, userObj);
            } else {
                console.log(ERROR.FINGERPRINT_ERROR + login);
                callback({success: false, message: ERROR.FINGERPRINT_ERROR}, userObj);
            }
        } catch (err) {
            console.log(err);
            callback(err, userObj);
        }
    } catch (err) {
        console.log(err);
        callback(err, userObj);
    } finally {
        db.close();
    }
}

async function basicAuth(login, password,fingerprint, callback){
    let db = await dbl.connect();
    try {
        let user = await db.collection('users').findOne({login: login, active: true});
        try {
            if (!user) {
                callback({success: false, message: ERROR.AUTH_ERROR}, {
                    auth: {
                        success: false,
                        message: ERROR.AUTH_ERROR
                    }
                });
            } else {
                bcrypt.compare(password, user.password, async function (err, res) {
                    if (!err) {
                        user = await genToken(user);
                        if (user.fingerprint && contains(user.fingerprint, fingerprint)) {
                            const ret = {
                                auth: {
                                    method: "basic",
                                    success: true,
                                    fingerprint: fingerprint,
                                    token: user.token,
                                    message: ERROR.LOGIN_SUCCESS_INFO
                                },
                                user: user
                            };
                            callback(err, ret);
                        } else {
                            const ret = {
                                auth: {
                                    method: "basic",
                                    success: true,
                                    fingerprint: fingerprint,
                                    token: user.token,
                                    message: ERROR.LOGIN_SUCCESS_INFO
                                },
                                user: user
                            };
                            db.close();
                            newDevice(ret, callback);
                        }
                    } else {
                        console.log("wrong password");
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
                });
            }
        }
        catch (err) {
            callback(err, false);
        } finally {
            db.close();
        }
    } catch(err) {
        console.error(err);
    }
}

async function tokenAuth(token, fingerprint, callback){
    let db = await dbl.connect();
    let user = (await db.collection('users').findOne({token: token, active : true}));
    try {
        if (!user) {
            const ret = {
                auth:{
                    method: "token",
                    success: false,
                    fingerprint: fingerprint,
                    message: ERROR.AUTH_ERROR}};
                    console.log(user);
            callback(true, ret);
        } else if (user.fingerprint && contains(user.fingerprint, fingerprint)){
            const ret = {
                auth:{
                    method: "token",
                    success: true,
                    fingerprint: fingerprint,
                    message: ERROR.LOGIN_SUCCESS_INFO},
                user: user};
            callback(false, ret);
        } else {
            const ret = {
                auth:{
                    method: "token",
                    success: true,
                    fingerprint: false,
                    message: ERROR.AUTH_DEVICE_ERROR},
                user: user};
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
    await authenticate(req.body.login, req.body.password, req.body.token, req.body.fingerprint, (err, ret) => {
        if (err || ret.auth.fingerprint == false) {
            console.error(err);
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(ret));
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(ret));
        }
    });
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

    console.log("Connection attempt from: " + login + ' (token: ' + token + ')');
    if (login && password && fingerprint) {
        basicAuth(login, password,fingerprint, callback);
    } else if (token && fingerprint) {
        tokenAuth(token, fingerprint, callback);
    }else {
        callback({message: ERROR.AUTH_ERROR},
            {auth:{success: false, message: ERROR.AUTH_ERROR}});
    }
}

export async function checkLogin(req, res, next){
    try {
        let test = await checkLoginHlp(req.params.login);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(test));
    } catch(err) { next(err)}
}

async function checkLoginHlp(login){
    let db = await dbl.connect();
    try {
        const collection = db.collection('users');
        let userCount = (await collection.find({
            login: login
        }).limit(1).count());
        if (userCount == 0 && !(/([ ])/.exec(login))) {
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
        console.log(collection);
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

export async function checkEmail(req, res, next){
    try {
        let test = await checkEmailHlp(req.params.email);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(test));
    } catch(err) { next(err)}
}

async function checkPass(pass1, pass2){
    if ((pass1 === pass2) &&
        (pass1.match(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,48}$/))){
        let password = await bcrypt.hashSync(pass1, saltRounds);
        return ({valid: true, message: "Valid password", password: password});
    } else {
        return({valid: false, message: ERROR.PASSWORD_FORMAT_ERROR});
    }
}

async function changePasswordHlp(token, password){
    let returnValue = null;
    await jwt.verify(token, credentials.jwtSecret, async function(err, ret){
        console.log(err.message);
        if (err){
            returnValue = ({ success: false, message: 'token is corrupted' });
        } else {
            let password2 = await bcrypt.hashSync(password, saltRounds);
            const email = ret.email;
            const db = await dbl.connect();
            let update = await db.collection('users').updateOne({email: email}, {$set: {password: password2}});
            try {
                if (update.modifiedCount == 1){
                    returnValue =({success: true, message: "Password updated successfully"});
                } else {
                    returnValue =({success: false, message: "An error happened while updating the password"});
                }
            } catch (err) {
                returnValue =({success: false, message: "Database error"});
            } finally {
                db.close();
            }
        }
    });
    return (returnValue);
}

export async function changePassword(req, res) {
    let token = req.body.token;
    if (req.body.password === req.body.password2){
        const password = req.body.password;
        let response = await changePasswordHlp(token, password);
        console.log(response);
        try {
            console.log(response);
            res.setHeader('Content-Type', 'application/json');
            res.send(response);
        } catch (err) {
            console.log(err);
            console.error(err);
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(response));
        }
    }else {
        res.setHeader('Content-Type', 'application/json');
        res.send({success: false, message: "Passwords didn't match"});
    }
}

async function requireNewPassword(email){
    //this methods sends an email with a temporary link for the user to create a new password
    let myToken = jwt.sign({email: email}, credentials.jwtSecret, {expiresIn: 900});
    const db = await dbl.connect();
    const user = await db.collection('users').findOne({email: email});
    try {
        if (!user || !user.firstName ) {
            return ({success: "false", message: "User wasn't found"});
        } else {
            let mailOptions = {
                from: '"liveoption" <customer-success@liveoption.io>', // sender address
                to: user.email, // list of receivers
                subject: 'Password reset requested on liveoption',
                html: '<b>Hello,</b></br><p>A password recovery procedure has been requested ' +
                'in your name on liveoption.io. If you requested a new password, please' +
                ' click on the following link to proceed.</p>' +
                '<a href="http://www.liveoption.io/change_password?token=' + myToken + '">Change my password now</a>' +
                '<p>If you didn\'t request a password reset, please disregard this email</p>' // html body
            };
            return await transporter.sendMail(mailOptions);
        }
    }catch (err) {
        console.log(err);
    } finally {
        db.close();
    }
}

export async function retrievePassword(req, res){
    let email = req.body.email;
    let response = await requireNewPassword(email, res);
    try {
        console.log(response);
        res.setHeader('Content-Type', 'application/json');
        res.send(response);
        console.log(response);
    } catch (err) {
        console.error(err);
    }
}

export async function Delete(res, req){
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

export function renderForm(req, res){
    res.send({message: "TU LA VU TA PAGE"})
}

export async function create(req, res){
    //this method adds a new user to the database
    let user = {};
    let errors = [];
    let emailProp = await checkEmailHlp(req.body.email);
    let loginProp = await checkLoginHlp(req.body.login);
    let passwordProp = await checkPass(req.body.password, req.body.password2);

    if (emailProp.valid) {user.email = emailProp.email} else errors.push(emailProp.message);
    if (loginProp.valid) {user.login = loginProp.login} else errors.push(loginProp.message);
    if (passwordProp.valid) {user.password = passwordProp.password} else errors.push(passwordProp.message);
    if (errors.length() == 0) {
        let db = dbl.connect();
        try {
            db.collection('users').insertOne(user);
        } finally {
            db.close();
        }
        await validateAccount(email);
        res.send({success: true, message: "user created, please check your emails"});
    } else {
        res.send({success: false, message: "Your account couldn't be created", errors: errors});
    }
}

async function validateAccount(email){
    let myToken = jwt.sign({email: email}, credentials.jwtSecret, {expiresIn: 900});
    let mailOptions = {
        from: '"liveoption" <customer-success@liveoption.io>', // sender address
        to: email, // list of receivers
        subject: 'Pleasee verify your liveoption account',
        html: '<b>Hello,</b></br><p>You just created a liveoption account. Please click the following link within the next 15mins. to verify your email address.</p>' +
        '<a href="http://www.liveoption.io/validate?token=' + myToken + '">Validate account now</a>' +
        '<p>Thank you for registering liveoption,</p><p>See you soon !</p>' // html body
    };
    return await transporter.sendMail(mailOptions);
}

export async function isVerified(res, req){
    //this method makes sure the user has authorized his account via email
    let email = req.user.email;
    let db = await dbl.connect();
    try{
        db.collection('users').updateOne({email: email}, {$set: {active: true}});
    } finally {
        db.close();
    }
    res.json({success: true, message: ERROR.ACCOUNT_VALIDATED_INFO})
};

export async function viewAll(res, req){res.send({message: "OK"})}
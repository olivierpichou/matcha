
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
import * as user from './user'
import findAll from '../model/findAll'
import popularity from '../model/popularity'


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


export const All = async (req, res) => {
    let query = {
            netflix: false,
            rightnow: false,
            age:{
                min:18,
                max: 77
            },
            popularity: {
                min: 0,
                max: 100
            },
            geocode: {
                lat: 0,
                lng: 0
            },
            tags: [],
            custom: ''
        },
        regexHashtag = /#([a-zA-Z0-9-]*)+/g,
        regexNetflix = /netflix/i,
        regexRightNow = /rightnow/i,
        regexAge = /age-from=([0-9]{1,2}).*age-to=([0-9]{1,2})/i, //min = group1, max = group2
        regexAgeMin = /age-from=[0-9]{1,2}/i,
        regexAgeMax = /age-to=[0-9]{1,2}/i,
        regexPopularity = /popularity-from=([0-9]{1,2}).*popularity-to=([0-9]{1,3})/i, //min = group1, max = group2
        regexPopularityMin = /popularity-from=[0-9]{1,2}/i,
        regexPopularityMax = /popularity-to=[0-9]{1,3}/i,
        regexGeocode = /around-lat=(-?[0-9]{1,2}\.?[0-9]{0,16}).*around-lng=(-?[0-9]{1,2}\.?[0-9]{0,16})/i, //lat = group1, lng = group2
        regexGeocodeLat = /around-lat=-?[0-9]{1,2}\.?[0-9]{0,16}/i,
        regexGeocodeLng = /around-lng=-?[0-9]{1,2}\.?[0-9]{0,16}/i,

        queryStr = req.query.query || ''

    query.netflix = regexNetflix.test(queryStr)
    query.rightnow = regexRightNow.test(queryStr)

    const age = regexAge.exec(queryStr)

    if (age) {
        query.age.min = age[1]
        query.age.max = age[2]
    }

    const popularity = regexPopularity.exec(queryStr)

    if (popularity) {
        query.popularity.min = popularity[1]
        query.popularity.max = popularity[2]
    }

    const geocode = regexGeocode.exec(queryStr)

    if (geocode) {
        query.geocode.lat = geocode[1]
        query.geocode.lng = geocode[2]
    }

    let i = 0,
        temp = []
    while ((temp = regexHashtag.exec(queryStr)) !== null) {
        query.tags[i] = temp[1]
        i++
    }
    query.custom = queryStr.replace(regexGeocodeLng, '')
        .replace(regexGeocodeLat, '')
        .replace(regexPopularityMax, '')
        .replace(regexPopularityMin, '')
        .replace(regexAgeMax, '')
        .replace(regexAgeMin, '')
        .replace(regexRightNow, '')
        .replace(regexNetflix, '')
        .replace(regexHashtag, '')
        .replace(/ (?: *)/, ' ')
        .split(' ')
        .filter(e => e !== '')


    let search = await findAll(req.user.username)
    res.send({success: true, users: search})

}

export const One = async (req, res) => {
    const login = req.params.userId
    const me = req.user.username
    let db = await dbl.connect()
    try {
        let user = await db.collection('users').findOne({login, active: true}, {
            password: false,
            token: false,
            fingerprint: false,
            email: false,
            firstName: false,
            lastName: false,
            _id: false,
            Lat: false,
            Lng: false
        })
        if (user) {
            let liked = await db.collection('likes').findOne({userId: me, otherId: login, likes: true})
            let likes_me = await db.collection('likes').findOne({userId: login, otherId: me, likes: true})
            let connection = await db.collection('connections').findOne({login})
            let visited = await db.collection('visits').findOne({userId:login, otherId: me})
            let var_popularity = await popularity(login)
            await db.collection('visits').insertOne({userId: me, otherId: login, visit: true, date: new Date()})
            res.send({
                success: true,
                user,
                liked: !!liked,
                likes_me: !!likes_me,
                connected: connection.connected,
                lastConnection: connection.date,
                visited: !!visited,
                popularity: var_popularity
            })
        } else {
            res.send({success: false})
        }
    } catch(err) {
        console.error(err)
    } finally{
        db.close()
    }
}

export const me = async (req,res) => {
    const login = req.user.username
    let db = await dbl.connect()
    try {
        let user = await db.collection('users').findOne({login, active: true})
        if (user) {
            res.send({success: true, login: req.user.username})
        } else {
            res.send({success: false, message: ERROR.AUTH_ERROR})
        }
    } finally {
        db.close()
    }

}

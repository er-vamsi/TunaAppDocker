const LocalStrategy = require('passport-local').Strategy
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
var Fabric_Client = require('fabric-client');
var path = require('path');
var os = require('os');

//Load User model

const User = require('../models/User')

module.exports = function (passport) {
    passport.use(
        new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
            //Match User
            User.findOne({ email: email })
                .then(user => {
                    if (!user) {
                        return done(null, false, { message: 'That email is not registered' })
                    }
                    //Match password
                    bcrypt.compare(password, user.password, (err, isMatch) => {
                        if (err) throw err;

                        if (isMatch) {
                            // Start HLF-CA User validation
                            var fabric_client = new Fabric_Client();
                            var member_user = null;
                            //var store_path = path.join(os.homedir(), '.hfc-key-store');
                            var store_path = '/usr/src/app/certs';
                            console.log('Store path:' + store_path);

                            // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
                            Fabric_Client.newDefaultKeyValueStore({
                                path: store_path
                            }).then((state_store) => {
                                // assign the store to the fabric client
                                fabric_client.setStateStore(state_store);
                                var crypto_suite = Fabric_Client.newCryptoSuite();
                                // use the same location for the state store (where the users' certificate are kept)
                                // and the crypto store (where the users' keys are kept)
                                var crypto_store = Fabric_Client.newCryptoKeyStore({ path: store_path });
                                crypto_suite.setCryptoKeyStore(crypto_store);
                                fabric_client.setCryptoSuite(crypto_suite);

                                // get the enrolled user from persistence, this user will sign all requests
                                return fabric_client.getUserContext(user.email, true);
                            }).then((user_from_store) => {
                                if (user_from_store && user_from_store.isEnrolled()) {
                                    console.log('Successfully loaded user from persistence');
                                    member_user = user_from_store;

                                    return done(null, user)
                                } else {
                                    //throw new Error('Failed to get user.... run registerUser.js');
                                    return done(null, false, { message: 'Failed to validate user in HLF-CA' })
                                }

                            })
                            // End HLF-CA User validation
                            //return done(null, user)
                        } else {
                            return done(null, false, { message: 'Password incorrect' })
                        }
                    })
                })
                .catch(err => console.log(err))
        })
    )
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser((id, done) => {
        User.findById(id, (err, user) => {
            done(err, user);
        });
    });
}
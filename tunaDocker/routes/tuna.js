var Fabric_Client = require('fabric-client');
var path = require('path');
var os = require('os');
var util = require('util')
const express = require('express')
const router = express.Router()

/*******************************************/
/*****************Add Tuna******************/
/*******************************************/

//GET
router.get('/addtuna', (req, res) => {
    res.render('addtuna', { name: req.user.name, email: req.user.email })
})

//POST
router.post('/addtuna', (req, res) => {
    const { cid, vname, longi, lati, timestmp, holder, email } = req.body

    console.log(req.body)
    var key1 = cid
    var timestamp1 = timestmp
    var location1 = longi + ',' + lati
    var vessel1 = vname
    var holder1 = holder
    var email1 = email

    var fabric_client = new Fabric_Client();

    // setup the fabric network
    var channel = fabric_client.newChannel('mychannel');
    var peer = fabric_client.newPeer('grpc://peer0.org1.example.com:7051');
    channel.addPeer(peer);
    var order = fabric_client.newOrderer('grpc://orderer.example.com:7050')
    channel.addOrderer(order);

    var member_user = null;
    //var store_path = path.join(os.homedir(), '.hfc-key-store');
    var store_path = '/usr/src/app/certs';
    console.log('Store path:' + store_path);
    var tx_id = null;

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
        return fabric_client.getUserContext(email1, true);
    }).then((user_from_store) => {
        if (user_from_store && user_from_store.isEnrolled()) {
            console.log('Successfully loaded' + email1 + ' from persistence');
            member_user = user_from_store;
        } else {
            throw new Error('Failed to get' + email1 + '... run registerUser.js');
        }

        // get a transaction id object based on the current user assigned to fabric client
        tx_id = fabric_client.newTransactionID();
        console.log("Assigning transaction_id: ", tx_id._transaction_id);

        // recordTuna - requires 5 args, ID, vessel, location, timestamp,holder - ex: args: ['10', 'Hound', '-12.021, 28.012', '1504054225', 'Hansel'], 
        // send proposal to endorser
        const request = {
            //targets : --- letting this default to the peers assigned to the channel
            chaincodeId: 'tuna-app',
            fcn: 'recordTuna',
            args: [key1, vessel1, location1, timestamp1, holder1],
            chainId: 'mychannel',
            txId: tx_id
        };

        // send the transaction proposal to the peers
        return channel.sendTransactionProposal(request);
    }).then((results) => {
        var proposalResponses = results[0];
        var proposal = results[1];
        let isProposalGood = false;
        if (proposalResponses && proposalResponses[0].response &&
            proposalResponses[0].response.status === 200) {
            isProposalGood = true;
            console.log('Transaction proposal was good');
        } else {
            console.error('Transaction proposal was bad');
        }
        if (isProposalGood) {
            console.log(util.format(
                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                proposalResponses[0].response.status, proposalResponses[0].response.message));

            // build up the request for the orderer to have the transaction committed
            var request = {
                proposalResponses: proposalResponses,
                proposal: proposal
            };

            // set the transaction listener and set a timeout of 30 sec
            // if the transaction did not get committed within the timeout period,
            // report a TIMEOUT status
            var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
            var promises = [];

            var sendPromise = channel.sendTransaction(request);
            promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

            // get an eventhub once the fabric client has a user assigned. The user
            // is required bacause the event registration must be signed
            //let event_hub = fabric_client.newEventHub();
            let event_hub = channel.newChannelEventHub('peer0.org1.example.com:7051');
            //event_hub.setPeerAddr('grpc://peer0.org1.example.com:7053');

            // using resolve the promise so that result status may be processed
            // under the then clause rather than having the catch clause process
            // the status
            let txPromise = new Promise((resolve, reject) => {
                let handle = setTimeout(() => {
                    event_hub.disconnect();
                    resolve({ event_status: 'TIMEOUT' }); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                }, 3000);
                event_hub.connect();
                event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                    // this is the callback for transaction event status
                    // first some clean up of event listener
                    clearTimeout(handle);
                    event_hub.unregisterTxEvent(transaction_id_string);
                    event_hub.disconnect();

                    // now let the application know what happened
                    var return_status = { event_status: code, tx_id: transaction_id_string };
                    if (code !== 'VALID') {
                        console.error('The transaction was invalid, code = ' + code);
                        resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                    } else {
                        console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                        resolve(return_status);
                    }
                }, (err) => {
                    //this is the callback if something goes wrong with the event registration or processing
                    reject(new Error('There was a problem with the eventhub ::' + err));
                });
            });
            promises.push(txPromise);

            return Promise.all(promises);
        } else {
            console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
            throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
        }
    }).then((results) => {
        console.log('Send transaction promise and event listener promise have completed');
        console.log(results)
        // check the results in the order the promises were added to the promise all list
        if (results && results[0] && results[0].status === 'SUCCESS') {
            console.log('Successfully sent transaction to the orderer.');
            //res.send(tx_id.getTransactionID());
        } else {
            console.error('Failed to order the transaction. Error code: ' + response.status);
        }

        if (results && results[1] && results[1].event_status === 'VALID') {
            console.log('Successfully committed the change to the ledger by the peer');
            req.flash('success_msg', 'Transaction commited successfully to Ledger')
            res.redirect('/dashboard')
            //res.send(tx_id.getTransactionID());
        } else {
            console.log('Transaction failed to be committed to the ledger due to ::' + results[1].event_status);
        }
    }).catch((err) => {
        console.error('Failed to invoke successfully :: ' + err);
    });


})

/*********************************************/
/*****************Query Tuna******************/
/*********************************************/

//GET
router.get('/querytuna', (req, res) => {
    res.render('querytuna', { name: req.user.name, email: req.user.email })
})

//POST
router.post('/querytuna', (req, res) => {

    const { catchId, email } = req.body

    console.log(req.body)
    var catchId1 = catchId
    var email1 = email

    var fabric_client = new Fabric_Client();

    // setup the fabric network
    var channel = fabric_client.newChannel('mychannel');
    var peer = fabric_client.newPeer('grpc://peer0.org1.example.com:7051');
    channel.addPeer(peer);

    //
    var member_user = null;
    //var store_path = path.join(os.homedir(), '.hfc-key-store');
    var store_path = '/usr/src/app/certs';
    console.log('Store path:' + store_path);
    var tx_id = null;

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
        return fabric_client.getUserContext(email1, true);
    }).then((user_from_store) => {
        if (user_from_store && user_from_store.isEnrolled()) {
            console.log('Successfully loaded' + email1 + ' from persistence');
            member_user = user_from_store;
        } else {
            throw new Error('Failed to get' + email1 + '... run registerUser.js');
        }



        // queryTuna - requires 1 argument, ex: args: ['4'],
        const request = {
            chaincodeId: 'tuna-app',
            txId: tx_id,
            fcn: 'queryTuna',
            args: [catchId1]
        };

        // send the query proposal to the peer
        return channel.queryByChaincode(request);
    }).then((query_responses) => {
        console.log("Query has completed, checking results");
        // query_responses could have more than one  results if there multiple peers were used as targets
        if (query_responses && query_responses.length == 1) {
            if (query_responses[0] instanceof Error) {
                console.error("error from query = ", query_responses[0]);
                res.send("Could not locate tuna")

            } else {
                console.log("Response is ", query_responses[0].toString());
                //res.send(query_responses[0].toString())
                var qres = JSON.parse(query_responses[0].toString())
                var holder = qres['holder']
                //res.redirect('/results')
                res.render('results', JSON.parse(query_responses[0].toString()))
            }
        } else {
            console.log("No payloads were returned from query");
            res.send("Could not locate tuna")
        }
    }).catch((err) => {
        console.error('Failed to query successfully :: ' + err);
        res.send("Could not locate tuna")
    });

})


/*********************************************/
/*****************Query All Tuna******************/
/*********************************************/
router.get('/queryalltuna', (req, res) => {

    console.log(req.body)
    var createName1 = req.user.name
    var email1 = req.user.email

    var fabric_client = new Fabric_Client();

    // setup the fabric network
    var channel = fabric_client.newChannel('mychannel');
    var peer = fabric_client.newPeer('grpc://peer0.org1.example.com:7051');
    channel.addPeer(peer);

    //
    var member_user = null;
    //var store_path = path.join(os.homedir(), '.hfc-key-store');
    var store_path = '/usr/src/app/certs';
    console.log('Store path:' + store_path);
    var tx_id = null;

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
        return fabric_client.getUserContext(email1, true);
    }).then((user_from_store) => {
        if (user_from_store && user_from_store.isEnrolled()) {
            console.log('Successfully loaded' + email1 + ' from persistence');
            member_user = user_from_store;
        } else {
            throw new Error('Failed to get' + email1 + '... run registerUser.js');
        }

        // queryTuna - requires 1 argument, ex: args: ['4'],
        const request = {
            chaincodeId: 'tuna-app',
            txId: tx_id,
            fcn: 'queryAllTuna',
            args: [createName1]
        };

        // send the query proposal to the peer
        return channel.queryByChaincode(request);
    }).then((query_responses) => {
        console.log("Query has completed, checking results");
        // query_responses could have more than one  results if there multiple peers were used as targets
        if (query_responses && query_responses.length == 1) {
            if (query_responses[0] instanceof Error) {
                console.error("error from query = ", query_responses[0]);
                res.send("Could not locate tuna")

            } else {
                //console.log("Response is ", query_responses[0].toString());
                var jsonString = query_responses[0].toString();
                var jsonObj = JSON.parse(jsonString);
                let records = []
                for (i = 0; i < jsonObj.length; i++) {
                    //console.log(jsonObj[i].Record);
                    jsonObj[i].Record.Key = parseInt(jsonObj[i].Key);
                    records.push(jsonObj[i].Record)
                }
                //Sorting records array
                function sort_by_key(array, key) {
                    return array.sort(function (a, b) {
                        var x = a[key]; var y = b[key];
                        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
                    });
                }
                console.log("Before Sorting ", records)
                records = sort_by_key(records, 'Key');
                console.log("After Sorting ", records)

                res.render('resultsall', { Records: records })
            }
        } else {
            console.log("No payloads were returned from query");
            res.send("Could not locate tuna")
        }
    }).catch((err) => {
        console.error('Failed to query successfully :: ' + err);
        res.send("Could not locate tuna")
    });

})



/*********************************************/
/*****************Change Owner******************/
/*********************************************/

//GET
router.get('/changeowner', (req, res) => {
    res.render('changeowner', { name: req.user.name, email: req.user.email })
})

//POST
router.post('/changeowner', (req, res) => {
    const { catchId, newOwner, email } = req.body

    console.log(req.body)
    var catchId1 = catchId
    var newOwner1 = newOwner
    var email1 = email

    var fabric_client = new Fabric_Client();

    // setup the fabric network
    var channel = fabric_client.newChannel('mychannel');
    var peer = fabric_client.newPeer('grpc://peer0.org1.example.com:7051');
    channel.addPeer(peer);
    var order = fabric_client.newOrderer('grpc://orderer.example.com:7050')
    channel.addOrderer(order);

    var member_user = null;
    //var store_path = path.join(os.homedir(), '.hfc-key-store');
    var store_path = '/usr/src/app/certs';
    console.log('Store path:' + store_path);
    var tx_id = null;

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
        return fabric_client.getUserContext(email1, true);
    }).then((user_from_store) => {
        if (user_from_store && user_from_store.isEnrolled()) {
            console.log('Successfully loaded' + email1 + ' from persistence');
            member_user = user_from_store;
        } else {
            throw new Error('Failed to get' + email1 + '... run registerUser.js');
        }

        // get a transaction id object based on the current user assigned to fabric client
        tx_id = fabric_client.newTransactionID();
        console.log("Assigning transaction_id: ", tx_id._transaction_id);

        // recordTuna - requires 5 args, ID, vessel, location, timestamp,holder - ex: args: ['10', 'Hound', '-12.021, 28.012', '1504054225', 'Hansel'], 
        // send proposal to endorser
        let request = {
            //targets : --- letting this default to the peers assigned to the channel
            chaincodeId: 'tuna-app',
            fcn: 'changeTunaHolder',
            args: [catchId1, newOwner1],
            chainId: 'mychannel',
            txId: tx_id
        };

        // send the transaction proposal to the peers
        return channel.sendTransactionProposal(request);
    }).then((results) => {
        var proposalResponses = results[0];
        var proposal = results[1];
        let isProposalGood = false;
        if (proposalResponses && proposalResponses[0].response &&
            proposalResponses[0].response.status === 200) {
            isProposalGood = true;
            console.log('Transaction proposal was good');
        } else {
            console.error('Transaction proposal was bad');
        }
        if (isProposalGood) {
            console.log(util.format(
                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                proposalResponses[0].response.status, proposalResponses[0].response.message));

            // build up the request for the orderer to have the transaction committed
            var request = {
                proposalResponses: proposalResponses,
                proposal: proposal
            };

            // set the transaction listener and set a timeout of 30 sec
            // if the transaction did not get committed within the timeout period,
            // report a TIMEOUT status
            var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
            var promises = [];

            var sendPromise = channel.sendTransaction(request);
            promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

            // get an eventhub once the fabric client has a user assigned. The user
            // is required bacause the event registration must be signed
            //let event_hub = fabric_client.newEventHub();
            let event_hub = channel.newChannelEventHub('peer0.org1.example.com:7051');
            //event_hub.setPeerAddr('grpc://peer0.org1.example.com:7053');

            // using resolve the promise so that result status may be processed
            // under the then clause rather than having the catch clause process
            // the status
            let txPromise = new Promise((resolve, reject) => {
                let handle = setTimeout(() => {
                    event_hub.disconnect();
                    resolve({ event_status: 'TIMEOUT' }); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                }, 3000);
                event_hub.connect();
                event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                    // this is the callback for transaction event status
                    // first some clean up of event listener
                    clearTimeout(handle);
                    event_hub.unregisterTxEvent(transaction_id_string);
                    event_hub.disconnect();

                    // now let the application know what happened
                    var return_status = { event_status: code, tx_id: transaction_id_string };
                    if (code !== 'VALID') {
                        console.error('The transaction was invalid, code = ' + code);
                        resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                    } else {
                        console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                        resolve(return_status);
                    }
                }, (err) => {
                    //this is the callback if something goes wrong with the event registration or processing
                    reject(new Error('There was a problem with the eventhub ::' + err));
                });
            });
            promises.push(txPromise);

            return Promise.all(promises);
        } else {
            console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
            throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
        }
    }).then((results) => {
        console.log('Send transaction promise and event listener promise have completed');
        console.log(results)
        // check the results in the order the promises were added to the promise all list
        if (results && results[0] && results[0].status === 'SUCCESS') {
            console.log('Successfully sent transaction to the orderer.');
            //res.send(tx_id.getTransactionID());
        } else {
            console.error('Failed to order the transaction. Error code: ' + response.status);
        }

        if (results && results[1] && results[1].event_status === 'VALID') {
            console.log('Successfully committed the change to the ledger by the peer');
            req.flash('success_msg', 'Owner/Holder changed successfully, Txn Id: ' + tx_id.getTransactionID())
            res.redirect('/dashboard')
            //res.send(tx_id.getTransactionID());
        } else {
            console.log('Transaction failed to be committed to the ledger due to ::' + results[1].event_status);
        }
    }).catch((err) => {
        console.error('Failed to invoke successfully :: ' + err);
    });


})

/*** Redirect to Dashboard from results page for Query and QueryAll Tuna ***/
router.post('/results', (req, res) => {
    res.redirect('/dashboard')
})

router.post('/resultsall', (req, res) => {
    res.redirect('/dashboard')
})

module.exports = router
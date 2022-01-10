/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { connect, Contract } from '@hyperledger/fabric-gateway';
import { TextDecoder } from 'util';
import {
    newGrpcConnection,
    newIdentity,
    newSigner,
    tlsCertPathOrg1,
    peerEndpointOrg1,
    peerNameOrg1,
    certPathOrg1,
    keyDirectoryPathOrg1,
    tlsCertPathOrg2,
    peerEndpointOrg2,
    peerNameOrg2,
    certPathOrg2,
    keyDirectoryPathOrg2,
} from './connect';

const channelName = 'mychannel';
const chaincodeName = 'private';
const mspIdOrg1 = 'Org1MSP';
const mspIdOrg2 = 'Org2MSP';

const utf8Decoder = new TextDecoder();

//Collection Names
const org1PrivateCollectionName = 'Org1MSPPrivateCollection';
const org2PrivateCollectionName = 'Org2MSPPrivateCollection';

const RED = '\x1b[31m\n';
const RESET = '\x1b[0m';

//Use a random key so that we can run multiple times
const now = Date.now();
const assetID1 = `asset${now}`;
const assetID2 = `asset${now + 1}`;

async function main(): Promise<void> {
    // The gRPC client connection from org1 should be shared by all Gateway connections to this endpoint.
    const clientOrg1 = await newGrpcConnection(
        tlsCertPathOrg1,
        peerEndpointOrg1,
        peerNameOrg1
    );

    const gatewayOrg1 = connect({
        client: clientOrg1,
        identity: await newIdentity(certPathOrg1, mspIdOrg1),
        signer: await newSigner(keyDirectoryPathOrg1),
    });

    // The gRPC client connection from org2 should be shared by all Gateway connections to this endpoint.
    const clientOrg2 = await newGrpcConnection(
        tlsCertPathOrg2,
        peerEndpointOrg2,
        peerNameOrg2
    );

    const gatewayOrg2 = connect({
        client: clientOrg2,
        identity: await newIdentity(certPathOrg2, mspIdOrg2),
        signer: await newSigner(keyDirectoryPathOrg2),
    });

    try {
    // Get the smart contract from the network.
        const contractOrg1 = gatewayOrg1
            .getNetwork(channelName)
            .getContract(chaincodeName);

        // Get the smart contract from the network.
        const contractOrg2 = gatewayOrg2
            .getNetwork(channelName)
            .getContract(chaincodeName);

        console.log('\n~~~~~~~~~~~~~~~~ As Org1 Client ~~~~~~~~~~~~~~~~');

        // Create new assets on the ledger.
        await createAssets(contractOrg1);

        //Read asset from the org1's private data collection with ID in the given range.
        await getAssetsByRange(contractOrg1);

        try{
            //Attempt to transfer asset without prior aprroval from org2, transaction expected to fail.
            console.log('\n--> Attempt Transaction: TransferAsset Without AgreeToTransfer ' + assetID1
            );
            await transferAsset(contractOrg1);
        }
        catch(e){
            console.log('Expected to fail:')
            console.log(`Successfully caught the error: \n    ${e}`);
        }

        console.log('\n~~~~~~~~~~~~~~~~ As Org2 Client ~~~~~~~~~~~~~~~~');

        //Read the asset by ID.
        await readAssetByID(contractOrg2);

        //Make agreement to transfer the asset from org1 to org2.
        await agreeToTransfer(contractOrg2);

        console.log('\n~~~~~~~~~~~~~~~~ As Org1 Client ~~~~~~~~~~~~~~~~');

        //Read transfer agreement.
        await readTransferAgreement(contractOrg1);

        // Tranfer asset to org2.
        await transferAsset(contractOrg1);

        //Again ReadAsset : results will show that the buyer identity now owns the asset.
        await readAssetByID(contractOrg1);

        //Confirm that transfer removed the private details from the Org1 collection.
        await checkPrivateDataIsRemoved(contractOrg1);

        console.log('\n~~~~~~~~~~~~~~~~ As Org2 Client ~~~~~~~~~~~~~~~~');

        try{
            //Non-owner Org2 should not be able to delete assetID2. Expect an error from DeleteAsset.
            await deleteAsset(contractOrg2);
        } catch (e) {
            console.log('Expected to fail')
            console.log(`Successfully caught the error: \n    ${e}`);
        }

        console.log('\n~~~~~~~~~~~~~~~~ As Org1 Client ~~~~~~~~~~~~~~~~');

        // Delete AssetID2 as Org1.
        console.log('--> Submit Transaction: DeleteAsset as Org1, ID: ' + assetID2);
        await deleteAsset(contractOrg1);

        console.log('\n~~~~~~~~~~~~~~~~ As Org2 Client ~~~~~~~~~~~~~~~~');

        //Org2 can read asset private details: Org2 is owner, and private details exist in new owner's Collection
        await readAssetPrivateDetails(contractOrg2,org2PrivateCollectionName);
    } finally {
        gatewayOrg1.close();
        clientOrg1.close();

        gatewayOrg2.close();
        clientOrg2.close();
    }
}

main().catch((error) => {
    console.error('******** FAILED to run the application:', error);
    process.exitCode = 1;
});

/**
 * Submit a transaction synchronously, blocking until it has been committed to the ledger.
 */
async function createAssets(contract: Contract): Promise<void> {
    const assetType = 'ValuableAsset';

    const asset1Data = {
        objectType: assetType,
        assetID: assetID1,
        color: 'green',
        size: 20,
        appraisedValue: 100,
    };

    console.log(
        'Adding Assets to work with:\n--> Submit Transaction: CreateAsset ' +
      assetID1
    );

    await contract.submit('CreateAsset', {
        transientData: { asset_properties: JSON.stringify(asset1Data) },
    });
    console.log(
        'Adding Assets to work with:\n--> Submit Transaction: CreateAsset ' +
      assetID2
    );

    const asset2Data = {
        objectType: assetType,
        assetID: assetID2,
        color: 'blue',
        size: 35,
        appraisedValue: 727,
    };

    await contract.submit('CreateAsset', {
        transientData: { asset_properties: JSON.stringify(asset2Data) },
    });

    console.log('*** Transaction committed successfully');
}

async function getAssetsByRange(contract: Contract): Promise<void> {
    // GetAssetByRange returns assets on the ledger with ID in the range of startKey (inclusive) and endKey (exclusive).
    console.log(
        '\n--> Evaluate Transaction: ReadAssetPrivateDetails from ' +
      org1PrivateCollectionName
    );
    const resultBytes = await contract.evaluateTransaction(
        'GetAssetByRange',
        assetID1,
        `asset${now + 2}`
    );

    const resultString = utf8Decoder.decode(resultBytes);
    if (resultString.length === 0) {
        doFail('Received empty query list for readAssetPrivateDetailsOrg1');
    }
    const result = JSON.parse(resultString);
    console.log('*** Result:', result);
}

async function readAssetByID(contract: Contract): Promise<void> {
    console.log('\n--> Evaluate Transaction: ReadAsset ' + assetID1);
    const resultBytes = await contract.evaluateTransaction('ReadAsset', assetID1);

    const resultString = utf8Decoder.decode(resultBytes);
    if (resultString.length === 0) {
        doFail('Received empty result for ReadAsset');
    }
    const result = JSON.parse(resultString);
    console.log('*** Result:', result);
}

async function agreeToTransfer(contract: Contract): Promise<void> {
    // Buyer from Org2 agrees to buy the asset assetID1 //
    // To purchase the asset, the buyer needs to agree to the same value as the asset owner

    const dataForAgreement = { assetID: assetID1, appraisedValue: 100 };
    console.log(
        '\n--> Submit Transaction: AgreeToTransfer payload ' +
      JSON.stringify(dataForAgreement)
    );

    await contract.submit('AgreeToTransfer', {
        transientData: { asset_value: JSON.stringify(dataForAgreement) },
    });

    console.log('*** Transaction committed successfully');
}

async function readTransferAgreement(contract: Contract): Promise<void> {
    console.log('\n--> Evaluate Transaction: ReadTransferAgreement ' + assetID1);

    const resultBytes = await contract.evaluateTransaction(
        'ReadTransferAgreement',
        assetID1
    );

    const resultString = utf8Decoder.decode(resultBytes);
    if (resultString.length === 0) {
        doFail('Received empty result for ReadTransferAgreement');
    }
    const result = JSON.parse(resultString);
    console.log('*** Result:', result);
}

async function transferAsset(contract: Contract): Promise<void> {
    console.log('\n--> Submit Transaction: TransferAsset ' + assetID1);

    const buyerDetails = { assetID: assetID1, buyerMSP: mspIdOrg2 };
    await contract.submit('TransferAsset', {
        transientData: { asset_owner: JSON.stringify(buyerDetails) },
    });

    console.log('*** Transaction committed successfully');
}

async function checkPrivateDataIsRemoved(contract: Contract): Promise<void> {
    // ReadAssetPrivateDetails reads data from Org's private collection: Should return empty
    const resultBytes = await contract.evaluateTransaction(
        'ReadAssetPrivateDetails',
        org1PrivateCollectionName,
        assetID1
    );

    const resultString = utf8Decoder.decode(resultBytes);
    if (resultString.length > 0) {
        doFail('Expected empty data from ReadAssetPrivateDetails');
    }
}

async function deleteAsset(contract: Contract): Promise<void> {
    const dataForDelete = { assetID: assetID2 };
    console.log('--> Submit Transaction: DeleteAsset, ID: ' + assetID2);
    await contract.submit('DeleteAsset', {
        transientData: { asset_delete: JSON.stringify(dataForDelete) },
    });

    console.log('*** Transaction committed successfully');
}
async function readAssetPrivateDetails(contract: Contract,collection:string): Promise<void> {
    // ReadAssetPrivateDetails reads data from Org2's private collection. Args: collectionName, assetID.
    console.log(
        '\n--> Evaluate Transaction: ReadAssetPrivateDetails from ' +
        collection
    );
    const resultBytes = await contract.evaluateTransaction(
        'ReadAssetPrivateDetails',
        collection,
        assetID1
    );

    const resultString = utf8Decoder.decode(resultBytes);
    if (resultString.length === 0) {
        doFail('Received empty query list for readAssetPrivateDetailsOrg2');
    }
    const result = JSON.parse(resultString);
    console.log('*** Result:', result);
}

export function doFail(msgString: string): never {
    console.error(`${RED}\t${msgString}${RESET}`);
    throw new Error(msgString);
}

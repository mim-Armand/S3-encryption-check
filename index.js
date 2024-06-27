import {
  CreateBucketCommand, DeleteBucketCommand,
  DeleteBucketInventoryConfigurationCommand, DeleteObjectsCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketInventoryConfigurationCommand,
  PutBucketPolicyCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {fromIni} from "@aws-sdk/credential-providers";
import * as fs from 'fs';
import {gunzip} from 'zlib';
import {promisify} from 'util';


// todo: update the following with your values:
const currentStep = 0; // refer to the article for more info
const destBucketName = 's3-inventory-reports-mim'; // globally unique name
const awsRegion = 'us-east-1'; // 'us-gov-west-1', etc..
const awsProfile = 'default'; // change if you use named profiles
const inventoryId = 'mimInventoryConfig' // this is just an id that we can use later to remove the configs after reports were generated.
const writeFiles = false; // change this to true if you want to check files before deleting ( + comment out the delete function in case 3 )
// --- --- --- --- --- --- --- --- --- --- ---

const client = new S3Client({
  region: awsRegion,
  credentials: fromIni({profile: awsProfile}),
});

// --------------- Creating a destination bucket. ---------------
async function createDest() {
  const b = client.send( new CreateBucketCommand({
    Bucket: destBucketName,
  }))
  const p = await client.send( new PutBucketPolicyCommand({
    Bucket: destBucketName,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'Inventory',
        Effect: 'Allow',
        Principal: {
          Service: 's3.amazonaws.com',
        },
        Action: 's3:PutObject',
        Resource: [`arn:aws:s3:::${destBucketName}/*`] // for govcloud it will be `arn:aws-us-gov:s3:::${destBucketName}`
      }]
    })
  }))
  return Promise.all([b, p]);
}
// --------------- Get a list of all buckets. ---------------
async function listBuckets() {
  const { Buckets } = await client.send( new ListBucketsCommand({}))
  return Buckets.filter( b => b.Name !== destBucketName ).map(b => b.Name);
}
// --------------- Put Inventory Configuration ---------------
async function configureInventory(bucketName, inventoryId) {
    return client.send( new PutBucketInventoryConfigurationCommand({
      Bucket: bucketName,
      Id: inventoryId,
      InventoryConfiguration: {
        Id: inventoryId,
        IsEnabled: true,
        IncludedObjectVersions: 'All',
        Schedule: {
          Frequency: 'Daily', // 'Weekly'
        },
        OptionalFields: [
          'EncryptionStatus', // we need this field
          'LastModifiedDate',
        ],
        Destination: {
          S3BucketDestination: {
            Bucket: `arn:aws:s3:::${destBucketName}`, // `arn:aws-us-gov:s3:::${destinationBucketName}`,
            Prefix: `${bucketName}`,
            Format: 'CSV',
          }
        }
      }
    }))
}
// --------------- Delete Inventory Configuration ---------------
async function deleteInventoryConfig(bucketName, inventoryId) {
  return client.send( new DeleteBucketInventoryConfigurationCommand({
    Bucket: bucketName,
    Id: inventoryId,
  }))
}

// --------------- Get objects and save them  ---------------
let notSSEArray = [];
async function geitObj(Key, bucketName) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key
  });
  const gunzipAsync = promisify(gunzip);
  try{
    const response = await client.send(command);
    let filename = Key.replaceAll("/", '-');
    const bodyStream = response.Body;
    if(filename.endsWith('.csv.gz')){
      if(!bodyStream){
        console.error('No body in the response for GetObject!');
        return;
      }
      const data = [];
      for await (const chunk of bodyStream ){
        data.push(chunk);
      }
      const gzipBuffer = Buffer.concat(data);
      let unzippedContent;
      try{
        const unzipBuffer = await gunzipAsync(gzipBuffer);
        unzippedContent = unzipBuffer.toString('utf-8');
      }catch (e) {
        console.error('Problem unzipping content.. ', e);
      }
      const lines = unzippedContent.trim().split('\n');
      let notSSE = false;
      for ( const line of lines ){
        const values = line.split(',').map(value => value.trim().replace(/(^"|"$)/g, ''));
        if(values[values.length - 1] === 'NOT-SSE'){ // set to SSE-S3, SSE-C, SSE-KMS, or NOT-SSE
          notSSE = true;
          notSSEArray.push({
            // "Bucket, Key, VersionId, IsLatest, IsDeleteMarker, LasModifiedDate, EncryptionStatus"
            Bucket: values[0],
            Key: values[1],
            VersionId: values[2],
            IsLatest: values[3],
            IsDeleteMarker: values[4],
            LastModifiedDate: values[5],
            EncryptionStatus: values[6],
          });
        }
      }
      if(notSSE){
        if(writeFiles) fs.writeFile('./reports/' + filename, unzippedContent, err => {
          if(err) {
            console.error('Error writing the file', filename);
          } else {
            console.log('File was written!', filename);
          }
        })
      }else{
        console.log('✅ All objects are encrypted: ', filename);
      }
    }else{
      console.log('✅', filename);
    }
  }catch (err){
    console.error('ERROR happened!', err);
  }
}

// --------------- List all objects in a bucket ---------------
async function listObject(bucketName) {
  let isTruncated = true;
  let command = new ListObjectsV2Command({MaxKeys: 3, Bucket: bucketName});
  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } = await client.send(command);
    if(!Contents){
      console.log('The requested bucket is empty:', bucketName);
      break;
    }
    Contents.map( async c => {
      await geitObj( c.Key, bucketName );
      // console.log('>>>>', c)
    });
    isTruncated = IsTruncated;
    command.input.ContinuationToken = NextContinuationToken;
  }
}
// --------------- Empty a bucket ---------------
async function emptyBckt(bucketName) {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    // MaxKeys: 9, // default and max is 1000
  });
  try{
    let isTruncated = true;
    let content = '';
    while(isTruncated){
      const { Contents, IsTruncated, NextContinuationToken } = await client.send(command);
      if(!Contents) {
        console.info('The bucket was already empty!', bucketName);
        break;
      }
      let objectsToBeDeleted = [];
      const contentsList = Contents.map( c => {
        objectsToBeDeleted.push({Key: c.Key});
        return ` --> ${c.Key}`;
      }).join('\n');
      content += contentsList + '\n';
      const deleteInput = {
        Bucket: bucketName,
        Delete: {
          Objects: objectsToBeDeleted
        },
        Quiet: true
      };
      const deleteCommand = new DeleteObjectsCommand(deleteInput);
      await client.send(deleteCommand);
      isTruncated = IsTruncated;
      command.input.ContinuationToken = NextContinuationToken;
    }
  } catch(err){
    console.error('Error!', err);
  }
}
// --------------- Delete a bucket ---------------
async function deleteBucket(bucketName) {
  const command = new DeleteBucketCommand({
    Bucket: bucketName,
    // MaxKeys: 9, // default and max is 1000
  });
  await client.send(command).then( d => console.log('Bucket was deleted!', d))
    .catch(err => console.error('Err!!! bucket could not be removed:', err));
}

switch (currentStep){
  case 1:
    await createDest().then(() => console.log('destination bucket created!')).catch(err => console.error('error while creating dest bucket', err));
    const buckets = await listBuckets().then( buckets => buckets).catch( err => console.error('error while getting the list of buckets', err));
    for( const b of buckets){ await configureInventory(b, inventoryId).then( c => console.log('Inventory Configuration was added', c)).catch(err => console.error('error putting inventory config.', err)) }
    break;
  case 2:
    const bucketsToCheck = await listBuckets().then( buckets => buckets).catch( err => console.error('error while getting the list of buckets', err));
    for( const b of bucketsToCheck){ await deleteInventoryConfig(b, inventoryId).then( c => console.log('Inventory Configuration was deleted', c)).catch(err => console.error('error deleting inventory config.', err)) }
    break;
  case 3:
    await listObject(destBucketName).then(r => console.log('objects listed!', r));
    if(writeFiles) await fs.writeFile('./reports/unencrypted.json', JSON.stringify(notSSEArray), err => {
      if (err) {
        console.error('Error writing the final JSON report', err);
      } else{
        console.info('The final json report is written.');
      }
    });
    const uniqueBucketValues = Array.from(new Set(notSSEArray.map( i => i.Bucket)));
    // Here we can delete the whole bucket ( if it's not needed ) or delete only the unencrypted objects or encrypt them
    // In our case we will be just deleting them which will be done in 2 steps: 1. empty bucket, 2. remove bucket
    for ( const b of uniqueBucketValues ) {
      await emptyBckt(b);
      await deleteBucket(b);
    }
    break;
  default:
    console.error('Provide the correct step in "currentStep" variable! received invalid currentStep:', currentStep);
}

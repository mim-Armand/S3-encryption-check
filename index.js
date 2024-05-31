import {
  CreateBucketCommand, ListBucketsCommand,
  PutBucketInventoryConfigurationCommand,
  PutBucketPolicyCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {fromIni} from "@aws-sdk/credential-providers";


// todo: update the following with your values:
const currentStep = 1; // refer to the article for more info
const destBucketName = 's3-inventory-reports-mim'; // globally unique name
const awsRegion = 'us-east-1'; // 'us-gov-west-1', etc..
const awsProfile = 'default'; // change if you use named profiles
const inventoryId = 'mimInventoryConfig' // this is just an id that we can use later to remove the configs after reports were generated.
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

switch (currentStep){
  case 1:
    await createDest().then(() => console.log('destination bucket created!')).catch(err => console.error('error while creating dest bucket', err));
    const buckets = await listBuckets().then( buckets => buckets).catch( err => console.error('error while getting the list of buckets', err));
    for( const b of buckets){ await configureInventory(b, inventoryId).then( c => console.log('Inventory Configuration was added', c)).catch(err => console.error('error putting inventory config.', err)) }
    break;
  case 2:
    break;
  default:
    console.error('Provide the correct step in "currentStep" variable!');
}

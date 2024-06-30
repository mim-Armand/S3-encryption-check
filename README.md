# S3-encryption-check
Verify all objects in S3 are encrypted at rest after enabling default bucket encryption!

# Main article:
This repository was created as part of a medium article I wrote, I'll try to include enough information here for you to be able to run the project, but for more information please feel free to refer to the main article bellow:

//todo


# How to run:

- Clone/Download the project and run `npm i`.
- You need to change the value of the `currentStep` on line 18 in the (index.js)[index.js] file to 1 and run the script and wait for a day.
- Then change the value to 2 to download the reports and disable generation of new ones.
- Then change it to 3 and check the code for additional changes required to empty buckets and delete them or adding functionality to encrypt the objects and putting them back ( you could even achieve this by downloading the object, removing it from the bucket and then uploading it again! )
- Optionally you could check / confirm that everything has worked by rerunning the step 1 and 2 again which should not produce any results this time. 





create the necessary migration scripts to support schema changes made locally to deploy to a production environment and output the directions on how to implement them Use this as instruction context: 

## Prompt Directions 

make the requested changes along with any necessary test additions or changes to verify the requested functionality without breaking existing functionality not included in the requested changes: 

if changes are made provide the changed files in a downloadable zip file and output directions on their paths in the application. create the necessary migration scripts to support schema changes made locally to deploy to a production environment and output the directions on how to implement them

if the changes made are around ports the application is running on, do not hardcode any port information in the application, use the .env file PORT variable to obtain the necessary port information

assume all changes requested that are for the user-interface also need to have built the necessary backend and data sources necessary to support the request

Create the logging support for the requested these changes to make diagnosing errors and transactions easy.  Also include the necessary front-end logging to to capture front-end error and transaction information.  Create separate access, api and front-end log files but bind all transactions with a common correlation id so the correlation id can be searched on in the access, error and front-end log files to view a complete transaction lifecycle.


<!-- The prompt below is for when you experienve deployment issues with nginx or other environment specific issues -->
deployed this to the stage environment in cloudpanel hostinger.  I uploaded some log files from the application and nginx for you to review and resolve.  Make the changes to address the following issue or issues described as necessary without breaking local development functionality and create a new zip file with  the changes.  Explain the changes you made.


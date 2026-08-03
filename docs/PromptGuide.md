## Prompt Directions 

make the requested changes along with any necessary test additions or changes to verify the requested functionality without breaking existing functionality not included in the requested changes: 

if changes are made provide the changed files in a downloadable zip file and output directions on their paths in the application. create the necessary migration scripts to support schema changes made locally to deploy to a production environment 

if the changes made are around ports the application is running on, do not hardcode any port information in the application, use the .env file PORT variable to obtain the necessary port information

assume all changes requested that are for the user-interface also need to have built the necessary backend and data sources necessary to support the request.  build the running of all migration scripts to modify the database schema into the npm install process.  This migration process should support implementing schema changes in other development environments.

Create the logging support for the requested these changes to make diagnosing errors and transactions easy.  Also include the necessary front-end logging to to capture front-end error and transaction information.  Create separate access, api and front-end log files but bind all transactions with a common correlation id so the correlation id can be searched on in the access, error and front-end log files to view a complete transaction lifecycle.

if an MD or documentation file is created it should be created and stored in the project docs folder

address npm audit - high vulnerabilities and do not implement dependencies that would introduce high vulnerabilities into the application

<!-- The prompt below is for when you experience deployment issues with nginx or other environment specific issues -->
deployed this to the stage environment in cloudpanel hostinger.  I uploaded some log files from the application and nginx for you to review and resolve.  Make the changes to address the following issue or issues described as necessary without breaking local development functionality and create a new zip file with  the changes.  Explain the changes you made.


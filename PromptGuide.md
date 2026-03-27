create the necessary migration scripts to support schema changes made locally to deploy to a production environment and output the directions on how to implement them Use this as instruction context: 

## Prompt Directions 

make the following changes along with any necessary test additions or changes to verify the requested functionality without breaking existing functionality not included in the requested changes: 

if changes are made provide the changed files in a downloadable zip file and output directions on their paths in the application. create the necessary migration scripts to support schema changes made locally to deploy to a production environment and output the directions on how to implement them

Create the logging support these changes to make diagnosing errors and transactions easy.  Also include the necessary front-end logging to to capture front-end error and transaction information.  Create separate access, api and front-end log files but bind all transactions with a common correlation id so the correlation id can be searched on in the access, error and front-end log files to view a complete transaction lifecycle.

<!--
Create a logging framework with the appropriate logging throughout the application to make diagnosing errors and transactions easy. Also include the necessary front-end logging to to capture front-end error and transaction information. Create separate access, api and front-end log files but bind all transactions with a common correlation id so the correlation id can be searched on in the access, error and front-end log files to view a complete transaction lifecycle.
-->
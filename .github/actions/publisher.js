const DA_TOKEN = process.env.DA_TOKEN;
const HELIX_TOKEN = process.env.HELIX_TOKEN;
const AEM_PAGE_PATH = process.env.AEM_PAGE_PATH;

function main() {
  console.log('DA_TOKEN:', DA_TOKEN);
  console.log('HELIX_TOKEN:', HELIX_TOKEN);
  console.log('AEM_PAGE_PATH:', AEM_PAGE_PATH);
  // console.log(process.env); // uncomment out if you want to see all the env variables

  if (
    AEM_PAGE_PATH &&
    AEM_PAGE_PATH.startsWith('/drafts/') &&
    AEM_PAGE_PATH.endsWith('.md')
  ) {
    console.log('AEM_PAGE_PATH starts with /drafts/ and ends with .md');
  } else {
    console.log('AEM_PAGE_PATH does not match the required pattern');
  }
}

main();

import axios from 'axios';
async function test() {
  const name = "Colosseum";
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages|pageterms&piprop=original&titles=${encodeURIComponent(name)}&origin=*`;
  try {
    const res = await axios.get(url);
    console.log("Direct query pages:", JSON.stringify(res.data.query.pages, null, 2));
    
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1&prop=pageimages&piprop=original&origin=*`;
    const resSearch = await axios.get(searchUrl);
    console.log("Search query pages:", JSON.stringify(resSearch.data.query.pages, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();

import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI("AIzaSyC8I896dI-8JeOUcJYgXosx4ytuh48KIbQ");
async function run() {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyC8I896dI-8JeOUcJYgXosx4ytuh48KIbQ");
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();

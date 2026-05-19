import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI("AIzaSyC8I896dI-8JeOUcJYgXosx4ytuh48KIbQ");
async function run() {
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
  try {
    const result = await model.generateContent("Olá, quem é você?");
    console.log(result.response.text());
  } catch (e) {
    console.error(e);
  }
}
run();

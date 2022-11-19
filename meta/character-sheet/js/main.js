import { CharacterSheet } from "./components.js";
import { createCharacterFromYamlObject } from "./model.js";

const yamlObject = window.meta.character;
const character = createCharacterFromYamlObject(yamlObject);

// const characterHtml = CharacterSheet({ character });
// document.querySelector("article").innerHTML = characterHtml;

import App from "./components/App.js";

ReactDOM.render(App, document.querySelector("article#react-root"));

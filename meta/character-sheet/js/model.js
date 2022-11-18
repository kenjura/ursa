export function createCharacterFromYamlObject(yamlObject) {
  let character = Object.assign({}, yamlObject);
  // TODO: validate character here
  processAttributes(character);
  return yamlObject;
}

function processAttributes(character) {
  character.attributes.forEach((attribute) => {
    attribute.modifier = Object.values(attribute.components).reduce(
      (p, c) => p + c,
      0
    );
  });
}

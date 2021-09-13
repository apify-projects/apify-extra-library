module.exports.generateInputs = () => {
    const inputs = [];
    for (let i = 0; i < 10; i++) {
        inputs.push({ message: `Hello ${i} times`});
    }
    return inputs;
}

module.exports.processItems = (items) => items;
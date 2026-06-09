const sampleNames = [
    "The Nightingale",
    "The Kraken",
    "The Phantom",
    "The Chimera",
    "The Shadow",
    "The Wraith",
    "The Viper",
    "The Falcon"
];

function generateCodename() {
    const idx = Math.floor(Math.random() * sampleNames.length)
    return sampleNames[idx];
}

module.exports = generateCodename;

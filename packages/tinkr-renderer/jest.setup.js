// the renderer reaches the main process through the bridge the preload script
// installs, and the store reads it the moment it is imported: a component test
// has no app behind it, so it gets a bridge that answers nothing and remembers
// every call, which is what a test of what a run is sent as reads
window.api = new Proxy({}, {get: (target, key) => (target[key] ??= jest.fn())})

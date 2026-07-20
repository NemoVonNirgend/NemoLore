export function createChatMetadataAccessor({ metadata, getMetadata } = {}, owner = 'Service') {
    const resolve = typeof getMetadata === 'function'
        ? getMetadata
        : () => metadata;

    function current() {
        const value = resolve();
        if (!value || typeof value !== 'object') {
            throw new TypeError(`${owner} requires mutable chat metadata.`);
        }
        return value;
    }

    current();
    return current;
}

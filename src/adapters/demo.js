export async function fetchInfrastructureDemo() {
    return {
        port: {
            status: "available",
            speedKbps: 1000000,
            speedLabel: "1000 Mbps"
        },
        exchange: {
            name: "KADIKÖY",
            distanceM: 1250
        },
        fiber: {
            available: true,
            maxSpeedKbps: 1000000,
            maxSpeedLabel: "1 Gbps"
        }
    };
}

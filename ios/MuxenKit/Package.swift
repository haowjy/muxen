// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "MuxenKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "MuxenKit", targets: ["MuxenKit"])],
    targets: [
        .target(name: "MuxenKit"),
        .testTarget(
            name: "MuxenKitTests",
            dependencies: ["MuxenKit"],
            path: "Tests",
            sources: ["MuxenKitTests"],
            resources: [.copy("Fixtures")]
        ),
    ]
)

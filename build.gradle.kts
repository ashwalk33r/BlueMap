// adding this helps intellij with resolving repositories to be able to download library docs and sources
plugins {
    bluemap.base
}

val textFiles = fileTree(rootDir) {
    include(
        "**/*.kt", "**/*.kts",
        "**/*.java",
        "**/*.gradle", "**/*.properties",
        "**/*.json", "**/*.yml", "**/*.yaml", "**/*.toml", "**/*.xml",
        "**/*.md", "**/*.txt",
        "**/*.html", "**/*.css", "**/*.scss",
        "**/*.js", "**/*.cjs", "**/*.mjs", "**/*.jsx", "**/*.vue",
        "**/*.sh", "**/*.conf", "**/*.cfg",
        "**/Dockerfile*", "**/.dockerignore",
        "**/Makefile",
        "**/.gitignore", "**/.gitattributes", "**/.editorconfig",
        "**/.eslintrc*", "**/.prettierrc*", "**/.prettierignore",
        "gradlew", "LICENSE", "LICENSE_HEADER",
    )
    exclude(
        ".git/**",
        "**/build/**",
        "**/.gradle/**",
        "**/node_modules/**",
        "dist/**",
        "common/webapp/dist/**",
        "common/src/main/resources/de/bluecolored/bluemap/webapp.zip",
        "core/src/main/resources/de/bluecolored/bluemap/resourceExtensions.zip",
        "**/*.bat",
    )
}

tasks.register("dos2unixCheck") {
    group = "verification"
    description = "Fails if any tracked text file contains CRLF line endings."
    doLast {
        val cr = '\r'.code.toByte()
        val offenders = textFiles.filter { it.isFile && it.readBytes().any { b -> b == cr } }.files
        if (offenders.isNotEmpty()) {
            val list = offenders.joinToString("\n  ") { it.relativeTo(rootDir).path }
            throw GradleException(
                "Files with CRLF line endings found (${offenders.size}):\n  $list\n" +
                "Run './gradlew dos2unixFix' to normalize them to LF."
            )
        }
    }
}

tasks.register("dos2unixFix") {
    group = "formatting"
    description = "Rewrites tracked text files to use LF line endings."
    doLast {
        val cr = '\r'.code.toByte()
        var changed = 0
        textFiles.forEach { f ->
            if (!f.isFile) return@forEach
            val bytes = f.readBytes()
            if (bytes.none { it == cr }) return@forEach
            f.writeBytes(bytes.filter { it != cr }.toByteArray())
            logger.lifecycle("dos2unixFix: ${f.relativeTo(rootDir).path}")
            changed++
        }
        logger.lifecycle("dos2unixFix: converted $changed file(s).")
    }
}

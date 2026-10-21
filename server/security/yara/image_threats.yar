// Pixels: YARA rules run against the raw bytes of every incoming image.
// Written for yara-x (VirusTotal's YARA rewrite); the syntax is compatible with classic YARA.
//
// These rules only look for things that have no business inside a raster image. They cannot prove
// that a file is safe, only that it contains known-bad or clearly out-of-place content.

rule embedded_pe_executable
{
    meta:
        description = "Windows PE executable embedded in an image"
        severity = "high"
    strings:
        $dos_stub = "This program cannot be run in DOS mode"
        $dos_stub_w = "This program must be run under Win32"
    condition:
        any of them
}

rule embedded_elf_executable
{
    meta:
        description = "ELF executable embedded in an image"
        severity = "high"
    strings:
        $elf = { 7F 45 4C 46 (01 | 02) (01 | 02) 01 }
    condition:
        $elf
}

rule script_tag_in_image
{
    meta:
        description = "HTML or script markup inside image data or metadata"
        severity = "high"
    strings:
        $script_open = "<script" nocase
        $script_close = "</script" nocase
        $js_url = "javascript:" nocase
        $vbs_url = "vbscript:" nocase
        $onerror = /on(error|load|mouseover)\s*=\s*["'a-z(]/ nocase
        $iframe = "<iframe" nocase
        $html_doc = /<!doctype\s+html/ nocase
    condition:
        any of them
}

rule server_side_code_in_image
{
    meta:
        description = "PHP, ASP or shell code hidden in an image (classic upload-bypass payload)"
        severity = "high"
    strings:
        $php_open = "<?php" nocase
        $php_short = /<\?=\s*\$/
        $asp_open = "<%@" nocase
        $asp_eval = /<%\s*(eval|execute)\s*\(/ nocase
        $shebang = /#!\/(bin|usr\/bin)\/(env |sh|bash|python|perl)/
        $powershell = /powershell(\.exe)?\s+-(enc|e|nop|w)\b/ nocase
        $eval_post = /eval\s*\(\s*(base64_decode|\$_(POST|GET|REQUEST))/ nocase
    condition:
        any of them
}

rule imagemagick_delegate_exploit
{
    meta:
        description = "ImageTragick-style MVG/SVG delegate command injection"
        severity = "high"
    strings:
        $push = "push graphic-context"
        $fill_url = /fill\s+['"]?url\(/ nocase
        $ephemeral = "ephemeral:" nocase
        $msl = "<image authenticate=" nocase
    condition:
        $push or $fill_url or $ephemeral or $msl
}

rule postscript_in_image
{
    meta:
        description = "Ghostscript / PostScript payload (EPS-in-image exploits)"
        severity = "high"
    strings:
        $ps = "%!PS-Adobe"
        $ps_run = /\/(Device|Output)\s+.*(%pipe%|%stdout)/
        $pipe = "%pipe%"
    condition:
        $ps or $pipe or $ps_run
}

rule windows_shortcut_or_script_in_image
{
    meta:
        description = "Windows scripting content (LNK header, WScript, mshta) inside an image"
        severity = "medium"
    strings:
        $lnk = { 4C 00 00 00 01 14 02 00 00 00 00 00 C0 00 00 00 00 00 00 46 }
        $wscript = "WScript.Shell" nocase
        $mshta = "mshta" nocase
        $cmd = /cmd(\.exe)?\s+\/c\s/ nocase
    condition:
        any of them
}

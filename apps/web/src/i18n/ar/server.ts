/** Arabic for what the server tells the user: the Security Gate's steps, notices and refusals, palettes and size presets. */
export const server: Record<string, string> = {
  // gate steps
  'Size & count limits': 'حدود الحجم والعدد',
  'File signature matches': 'توقيع الملف مطابق',
  'Format allowlist': 'قائمة الصيغ المسموحة',
  'Decompression-bomb check': 'فحص قنابل الضغط',
  'Structural validation': 'التحقق من البنية',
  'Hidden-payload & polyglot scan': 'فحص الحمولات المخفية والملفات المزدوجة الصيغة',
  'Malware scan': 'فحص البرمجيات الخبيثة',
  'Re-encoded to a clean format': 'أُعيد ترميزه إلى صيغة نظيفة',
  'Metadata stripped': 'أُزيلت البيانات الوصفية',
  // gate details
  'No data after the image end, no embedded executables or archives':
    'لا بيانات بعد نهاية الصورة، ولا ملفات تنفيذية أو أرشيفات مدمجة',
  'TIFF has no end marker: checked for embedded executables and archives only':
    'صيغة TIFF بلا علامة نهاية: فُحصت بحثًا عن ملفات تنفيذية وأرشيفات مدمجة فقط',
  'Fully decoded without errors': 'فُكّ ترميزها بالكامل دون أخطاء',
  'Decoded in a resource-limited process': 'فُكّ ترميزها في عملية محدودة الموارد',
  'Pixels re-encoded as a fresh 8-bit PNG': 'أُعيد ترميز البكسلات كصورة PNG جديدة بعمق 8 بت',
  'No metadata found': 'لا توجد بيانات وصفية',
  // notices
  'The lowest bits of every pixel were rewritten to remove any hidden data.':
    'أُعيدت كتابة أدنى بتات كل بكسل لإزالة أي بيانات مخفية.',
  'The transparency channel is almost opaque but its lowest bit looks random (possible hidden data).':
    'قناة الشفافية شبه معتمة لكن أدنى بت فيها يبدو عشوائيًا (احتمال وجود بيانات مخفية).',
  'ClamAV is not installed or not running, so signature scanning was skipped. Install it to add that layer; all other checks ran.':
    'برنامج ClamAV غير مثبّت أو غير مشغَّل، لذلك تم تخطي الفحص بالتواقيع. ثبّته لإضافة هذه الطبقة؛ أما بقية الفحوصات فقد جرت.',
  // refusals
  'The file is empty.': 'الملف فارغ.',
  'The sandboxed decoder was stopped (it hit the memory/CPU limit or crashed). The file was rejected.':
    'أُوقف فاك الترميز المعزول (بلغ حد الذاكرة أو المعالج أو تعطّل). رُفض الملف.',
  'The sanitised image could not be verified.': 'تعذّر التحقق من الصورة بعد تنظيفها.',
  'The image was rejected.': 'رُفضت الصورة.',
  'Out of memory while decoding.': 'نفدت الذاكرة أثناء فك الترميز.',
  'Decoding this image needs more memory than the sandbox allows.':
    'فك ترميز هذه الصورة يحتاج ذاكرة أكبر مما تسمح به البيئة المعزولة.',
  'SVG files are not accepted: they can carry scripts. Export the artwork as PNG first.':
    'ملفات SVG غير مقبولة لأنها قد تحمل أكواد برمجية. صدّر الرسمة بصيغة PNG أولًا.',
  'GIF is not an accepted format. Convert it to PNG or WebP.': 'صيغة GIF غير مقبولة. حوّلها إلى PNG أو WebP.',
  'This file is not a recognised image. Accepted: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF.':
    'هذا الملف ليس صورة معروفة. المقبول: PNG وJPEG وWebP وTIFF وBMP وHEIC وAVIF.',
  'A Windows executable is embedded in the file.': 'ملف تنفيذي لويندوز مدمج داخل الملف.',
  'A Linux executable is embedded in the file.': 'ملف تنفيذي للينكس مدمج داخل الملف.',
  'A ZIP archive is embedded in the file.': 'أرشيف ZIP مدمج داخل الملف.',
  "The file's internal box layout is inconsistent (truncated, or extra data after the last box).":
    'تخطيط الصناديق الداخلية للملف غير متسق (مقطوع، أو توجد بيانات زائدة بعد آخر صندوق).',
  'Windows PE executable embedded in an image': 'ملف تنفيذي بصيغة Windows PE مدمج في صورة',
  'ELF executable embedded in an image': 'ملف تنفيذي بصيغة ELF مدمج في صورة',
  'HTML or script markup inside image data or metadata':
    'وسوم HTML أو أكواد برمجية داخل بيانات الصورة أو بياناتها الوصفية',
  'PHP, ASP or shell code hidden in an image (classic upload-bypass payload)':
    'كود PHP أو ASP أو سطر أوامر مخفي في صورة (حمولة تقليدية لتجاوز فحص الرفع)',
  'ImageTragick-style MVG/SVG delegate command injection': 'حقن أوامر عبر MVG/SVG على نمط ImageTragick',
  'Ghostscript / PostScript payload (EPS-in-image exploits)':
    'حمولة Ghostscript أو PostScript (استغلالات EPS داخل الصور)',
  'Windows scripting content (LNK header, WScript, mshta) inside an image':
    'محتوى سكربتات ويندوز (ترويسة LNK وWScript وmshta) داخل صورة',
  // kinds of files named in refusals
  'a Windows executable': 'ملف تنفيذي لويندوز',
  'a Linux executable': 'ملف تنفيذي للينكس',
  'a macOS executable': 'ملف تنفيذي لماك',
  'a ZIP archive': 'أرشيف ZIP',
  'a RAR archive': 'أرشيف RAR',
  'a 7-Zip archive': 'أرشيف 7-Zip',
  'a gzip archive': 'أرشيف gzip',
  'a PDF': 'ملف PDF',
  'a script': 'سكربت',
  'a HTML': 'ملف HTML',
  'a GIF': 'صورة GIF',
  'a SVG/XML': 'ملف SVG/XML',
  'Windows executable': 'ملف تنفيذي لويندوز',
  'Linux executable': 'ملف تنفيذي للينكس',
  'macOS executable': 'ملف تنفيذي لماك',
  'ZIP archive': 'أرشيف ZIP',
  'RAR archive': 'أرشيف RAR',
  '7-Zip archive': 'أرشيف 7-Zip',
  'gzip archive': 'أرشيف gzip',
  script: 'سكربت',
  // access and network (middleware)
  'Unexpected Host header. Pixels only answers on localhost.':
    'ترويسة Host غير متوقعة. يستجيب بكسلز على المضيف المحلي فقط.',
  'Cross-origin requests are not allowed.': 'الطلبات عبر المصادر المختلفة غير مسموحة.',
  'Missing or wrong access token.': 'رمز الوصول مفقود أو خاطئ.',
  'No such image.': 'لا توجد صورة بهذا الرقم.',
  'This batch is unknown, expired or already full.': 'هذه الدفعة غير معروفة أو انتهت صلاحيتها أو امتلأت.',
  'The project file is too large.': 'ملف المشروع كبير جدًا.',
  'That could not be applied. Check the settings and try again.':
    'تعذّر تطبيق ذلك. تحقق من الإعدادات وحاول مجددًا.',
  'The mask is not valid.': 'القناع غير صالح.',
  'Paint over the thing you want to remove first.': 'ارسم فوق الشيء الذي تريد إزالته أولًا.',
  "A layer's picture is no longer available. Add it again.": 'صورة الطبقة لم تعد متاحة. أضفها من جديد.',
  'colour must be #rrggbb': 'يجب أن يكون اللون بصيغة #rrggbb',
  'The result would be larger than this computer is set up to handle.':
    'ستكون النتيجة أكبر مما أُعدّ هذا الجهاز للتعامل معه.',
  'No background of that colour was found. Try a higher tolerance.':
    'لم يُعثر على خلفية بهذا اللون. جرّب تسامحًا أعلى.',
  'That would remove the whole picture. Try a lower tolerance.': 'هذا سيزيل الصورة كلها. جرّب تسامحًا أقل.',
  'Choose or import a palette first.': 'اختر لوحة ألوان أو استوردها أولًا.',
  'The mask must have the same size as the picture.': 'يجب أن يكون للقناع حجم الصورة نفسه.',
  'This edit has layers but their pictures are not available.':
    'يحتوي هذا التعديل على طبقات لكن صورها غير متاحة.',
  'Encrypted project files are not supported.': 'ملفات المشاريع المشفّرة غير مدعومة.',
  'The project uses an unsupported compression method.': 'يستخدم المشروع طريقة ضغط غير مدعومة.',
  'This project was made by a newer or different program.': 'صُنع هذا المشروع ببرنامج أحدث أو مختلف.',
  'The history position is outside the history.': 'موضع السجل خارج نطاق السجل.',
  'The layer pictures in the project do not match its layers.': 'صور الطبقات في المشروع لا تطابق طبقاته.',
  'That transform cannot be undone (it flattens the image).':
    'لا يمكن التراجع عن هذا التحويل (إنه يسطّح الصورة).',
  // pixel-art palettes (proper names stay as they are)
  Automatic: 'تلقائية',
  // size preset groups
  Social: 'التواصل الاجتماعي',
  Stores: 'المتاجر',
  Web: 'الويب',
  Video: 'الفيديو',
}

/** Server sentences with values in them: [pattern, Arabic]. `$1`, `$2` are the captured parts (translated when known). */
export const serverPatterns: Array<[RegExp, string]> = [
  // history entries that carry a name
  [/^Action: (.+)$/, 'إجراء: $1'],
  [/^Brush: (.+)$/, 'فرشاة: $1'],
  [/^Liquify: (.+)$/, 'تشكيل: $1'],
  [/^Add (.+\.\w{2,4})$/, 'إضافة $1'],
  [/^“(.+)” is empty\.$/, '«$1» فارغ.'],
  [/^“(.+)” is ([\d.,]+) MB; the limit is ([\d.,]+) MB\.$/, '«$1» حجمه $2 م.ب، والحد الأقصى $3 م.ب.'],
  [/^“(.+)”: (.+) files are not accepted\.(.*)$/, '«$1»: ملفات $2 غير مقبولة.$3'],
  [/^“(.+)” does not look like a supported image\.$/, '«$1» لا يبدو صورة مدعومة.'],
  [/^Detected (.+)$/, 'تم اكتشاف $1'],
  [/^(.+) is allowed$/, '$1 مسموح'],
  [/^Clean \(ClamAV \+ (\d+) YARA rules\)$/, 'سليم (ClamAV + $1 قاعدة YARA)'],
  [/^Clean \((\d+) YARA rules\)$/, 'سليم ($1 قاعدة YARA)'],
  [/^Ran: (\d+) YARA rules$/, 'جرى: $1 قاعدة YARA'],
  [/^Ran: nothing$/, 'لم يجرِ شيء'],
  [/^Removed: (.+)$/, 'أُزيل: $1'],
  [/^The file is ([\d,.]+) MB; the limit is ([\d,.]+) MB\.$/, 'حجم الملف $1 م.ب، والحد الأقصى $2 م.ب.'],
  [/^The file is larger than the ([\d,.]+) MB limit\.$/, 'الملف أكبر من الحد الأقصى $1 م.ب.'],
  [
    /^The file is named (\S+) but its contents are (an? .+), not an image\.$/,
    'اسم الملف $1 لكن محتواه $2 وليس صورة.',
  ],
  [
    /^The file is named (\S+) but its contents are (.+)\. Rename it or re-export it from the app that made it\.$/,
    'اسم الملف $1 لكن محتواه $2. غيّر اسمه أو أعد تصديره من البرنامج الذي أنشأه.',
  ],
  [
    /^(.+) files are not images\. Accepted: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF\.$/,
    'ملفات $1 ليست صورًا. المقبول: PNG وJPEG وWebP وTIFF وBMP وHEIC وAVIF.',
  ],
  [/^Decoding took longer than (\d+) s and was stopped\.$/, 'استغرق فك الترميز أكثر من $1 ثانية فتم إيقافه.'],
  [/^ClamAV flagged this file: (.+)\.$/, 'علّم برنامج ClamAV هذا الملف: $1.'],
  [/^ClamAV is required but unavailable \((.+)\)\.$/, 'برنامج ClamAV مطلوب لكنه غير متاح ($1).'],
  [/^ClamAV skipped this file: (.+)\.$/, 'تخطى برنامج ClamAV هذا الملف: $1.'],
  [/^YARA rules could not be loaded \((.+)\)\.$/, 'تعذّر تحميل قواعد YARA ($1).'],
  [
    /^A batch can hold at most (\d+) files; you selected (\d+)\.$/,
    'تتسع الدفعة لـ $1 ملف على الأكثر؛ وقد حدّدت $2.',
  ],
  [
    /^The lowest colour bits look random over the first (\d+)% of the picture \(typical of LSB steganography\)\.$/,
    'تبدو أدنى بتات الألوان عشوائية في أول $1% من الصورة (وهذا نمط شائع في إخفاء البيانات بالبتات الدنيا).',
  ],
  [
    /^The file has (\d+) frames; only the first one was imported\.$/,
    'يحتوي الملف على $1 إطارات؛ استُورد الأول فقط.',
  ],
  [/^The embedded colour profile could not be applied \((.+)\)\.$/, 'تعذّر تطبيق ملف الألوان المدمج ($1).'],
  [
    /^The image is ([\d,]+) x ([\d,]+) pixels \((.+)\), which is more than this setup will open\.?$/,
    'أبعاد الصورة $1 × $2 بكسل ($3)، وهذا أكبر مما يفتحه هذا الجهاز.',
  ],
  [/^Decompression-bomb protection triggered: (.+)$/, 'فعّلت الحماية من قنابل الضغط: $1'],
  [/^The image structure is invalid \((.+)\)\.$/, 'بنية الصورة غير صالحة ($1).'],
  [/^The image is truncated or corrupt \((.+)\)\.$/, 'الصورة مقطوعة أو تالفة ($1).'],
  [
    /^([\d,]+) bytes of extra data follow the end of the image \(at byte ([\d,]+)\)\. Hidden data appended to an image is a common way to smuggle payloads\.$/,
    'تتبع نهايةَ الصورة $1 بايت من البيانات الزائدة (عند البايت $2). إلحاق بيانات مخفية بالصورة طريقة شائعة لتهريب الحمولات.',
  ],
  [/^A (.+) is embedded in the file\.$/, '$1 مدمج داخل الملف.'],
  [/^Unknown platforms: (.+)$/, 'منصات غير معروفة: $1'],
  [/^Unknown size preset: (.+)$/, 'قالب حجم غير معروف: $1'],
  [/^A project can hold at most (\d+) layer pictures\.$/, 'يتسع المشروع لـ $1 صورة طبقة على الأكثر.'],
  [/^The project description is invalid: (.+)$/, 'وصف المشروع غير صالح: $1'],
  [/^A picture can hold at most (\d+) layers\.$/, 'تتسع الصورة لـ $1 طبقة على الأكثر.'],
]

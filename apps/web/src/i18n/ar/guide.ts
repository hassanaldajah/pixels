/** Arabic for the in-app user guide (apps/web/src/help/guide.ts). */
export const guide: Record<string, string> = {
  // --- getting started
  'Getting started': 'البدء',
  'Open a picture, change it, save it.': 'افتح صورة، وعدّلها، واحفظها.',
  'pixels is an image editor that runs entirely on your computer. It works offline, needs no account, and sends nothing anywhere. There is no AI in it: every tool uses ordinary, predictable maths.':
    'بكسلز محرّر صور يعمل بالكامل على جهازك. يعمل بلا إنترنت، ولا يحتاج إلى حساب، ولا يرسل شيئًا إلى أي مكان. وليس فيه ذكاء اصطناعي: كل أداة تستخدم حسابات عادية يمكن التنبؤ بها.',
  'Open a picture: drag a file onto the window, paste from the clipboard (Ctrl+V), or press Open (Ctrl+O).':
    'افتح صورة: اسحب ملفًا إلى النافذة، أو الصق من الحافظة (Ctrl+V)، أو اضغط «فتح» (Ctrl+O).',
  'Pick a tool on the left, or press its letter key. Its controls appear in the Inspector on the right.':
    'اختر أداة من شريط الأدوات، أو اضغط حرفها. تظهر عناصر التحكم الخاصة بها في لوحة الخصائص.',
  'Look at the result as you go. Hold the backslash key (\\) to see the original, or use Split / Side in the top bar.':
    'تابع النتيجة أثناء العمل. اضغط مفتاح الشرطة المائلة العكسية (\\) مطولًا لترى الأصل، أو استخدم «تقسيم» و«جنبًا إلى جنب» في الشريط العلوي.',
  'Save your work: Export for a finished picture, or Save project to keep editing later.':
    'احفظ عملك: «تصدير» للصورة النهائية، أو «حفظ المشروع» لمتابعة التعديل لاحقًا.',
  'Nothing you do changes your original file. Edits are kept as a list of steps, so you can always go back.':
    'لا شيء مما تفعله يغيّر ملفك الأصلي. تُحفظ التعديلات كقائمة خطوات، فيمكنك دائمًا الرجوع.',
  // --- security
  'Opening pictures safely': 'فتح الصور بأمان',
  'Every file is checked before you see it.': 'يُفحص كل ملف قبل أن تراه.',
  'A picture can hide trouble: a fake file type, a decompression bomb, a program tucked inside. So pixels treats every file as untrusted. Before it appears, the file is checked by its real bytes, scanned for hidden payloads and malware, opened in a locked-down helper process, and saved again as a clean PNG with all metadata removed.':
    'قد تُخفي الصورة مشكلة: نوع ملف مزيّف، أو قنبلة ضغط، أو برنامج مدسوس بداخلها. لذلك يعامل بكسلز كل ملف على أنه غير موثوق. قبل ظهوره يُفحص الملف من خلال بايتاته الحقيقية، ويُمسح بحثًا عن حمولات مخفية وبرمجيات خبيثة، ويُفتح في عملية مساعدة مقيّدة، ثم يُحفظ من جديد بصيغة PNG نظيفة بعد إزالة كل بياناته الوصفية.',
  'The "Security report" in the Inspector lists every check and its result.':
    'يسرد «تقرير الأمان» في لوحة الخصائص كل فحص ونتيجته.',
  'If a file fails a check it is refused, with the reason in plain words.':
    'إذا رسب الملف في فحص فإنه يُرفض مع ذكر السبب بكلمات واضحة.',
  '"Hidden data" in the Inspector: pixels screens every picture for data hidden in its pixel values. "Looks suspicious" is a warning, not a refusal: noisy photos can look similar.':
    'بند «بيانات مخفية» في لوحة الخصائص: يفحص بكسلز كل صورة بحثًا عن بيانات مخفية في قيم بكسلاتها. وعبارة «تبدو مشبوهة» تحذير وليست رفضًا: فالصور الكثيرة الضجيج قد تبدو مشابهة.',
  '"SHA-256" in the Inspector is the fingerprint of the original file. The VirusTotal link next to it looks that fingerprint up; the picture itself is never uploaded.':
    'بند «SHA-256» في لوحة الخصائص هو بصمة الملف الأصلي. ورابط VirusTotal بجانبه يبحث عن هذه البصمة؛ أما الصورة نفسها فلا تُرفع أبدًا.',
  'Supported: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF. Large files are capped for safety.':
    'الصيغ المدعومة: PNG وJPEG وWebP وTIFF وBMP وHEIC وAVIF. وللأمان توجد حدود لحجم الملفات الكبيرة.',
  'Camera information (model, exposure, date) is removed on opening. You can choose to put a short, checked list of it back when you export. GPS stays off unless you switch it on.':
    'تُزال معلومات الكاميرا (الطراز والتعريض والتاريخ) عند الفتح. ويمكنك أن تختار إعادة قائمة قصيرة مُتحقَّقًا منها عند التصدير. ويبقى موقع GPS متوقفًا ما لم تشغّله.',
  // --- workspace
  'The workspace': 'مساحة العمل',
  'Tool rail, canvas, Inspector, history.': 'شريط الأدوات واللوحة ولوحة الخصائص والسجل.',
  'Tool rail (left): the tools. Each has a letter key.':
    'شريط الأدوات (على جانب الشاشة): الأدوات، ولكل منها حرف مختصر.',
  'Canvas (middle): your picture. Scroll to zoom, hold Space and drag (or use the middle mouse button) to move around, double-click to fit the picture to the window.':
    'اللوحة (في الوسط): صورتك. مرّر العجلة للتكبير، واضغط المسافة مع السحب (أو زر الفأرة الأوسط) للتنقل، وانقر مرتين لملاءمة الصورة للنافذة.',
  'Inspector (right): the controls for the current tool, plus Image facts, Histogram, Security report, Selection, Local adjustments, Layers and History.':
    'لوحة الخصائص (على الجانب الآخر): عناصر التحكم في الأداة الحالية، إضافة إلى معلومات الصورة والمدرّج التكراري وتقرير الأمان والتحديد والتعديلات الموضعية والطبقات والسجل.',
  'Top bar: Undo / Redo, Edit / Split / Side views, zoom, preview quality, Open, Save project and Export.':
    'الشريط العلوي: تراجع وإعادة، وطرق العرض (تعديل وتقسيم وجنبًا إلى جنب)، والتكبير، وجودة المعاينة، وفتح، وحفظ المشروع، وتصدير.',
  'Rulers and guides: drag from a ruler to pull out a guide. Drag it back out to remove it.':
    'المساطر وخطوط الإرشاد: اسحب من مسطرة لإخراج خط إرشاد، واسحبه إلى الخارج لإزالته.',
  'Preview quality (top bar) only changes how sharp the on-screen preview is while you work. Export always uses the full resolution.':
    'جودة المعاينة (في الشريط العلوي) تغيّر وضوح المعاينة على الشاشة أثناء العمل فقط. أما التصدير فيستخدم الدقة الكاملة دائمًا.',
  'Press Ctrl+K for the command palette: type what you want to do and press Enter.':
    'اضغط Ctrl+K لفتح لوحة الأوامر: اكتب ما تريد فعله ثم اضغط Enter.',
  // --- history
  'Undo, redo and history': 'التراجع والإعادة والسجل',
  'Every step is kept.': 'تُحفظ كل خطوة.',
  'Ctrl+Z goes back one step. Ctrl+Shift+Z (or Ctrl+Y) goes forward.':
    'الاختصار Ctrl+Z يرجع خطوة واحدة. والاختصار Ctrl+Shift+Z (أو Ctrl+Y) يتقدم خطوة.',
  'The History list in the Inspector shows every step. Click one to jump back to it.':
    'تعرض قائمة السجل في لوحة الخصائص كل خطوة. انقر إحداها للعودة إليها مباشرة.',
  'Dragging a slider counts as one step, however long you drag.':
    'سحب شريط التمرير يُحسب خطوة واحدة مهما طال السحب.',
  'Eraser, Retouch and Upscale create a new version of the picture. Their own "Undo last change" button returns to the version before.':
    'تنشئ الممحاة والتنقيح وتكبير الدقة نسخة جديدة من الصورة. وزر «تراجع عن آخر تغيير» الخاص بها يعيدك إلى النسخة السابقة.',
  // --- transform
  'Transform: crop, rotate, resize': 'التحويل: قص وتدوير وتغيير الحجم',
  'Change the shape and size.': 'غيّر الشكل والحجم.',
  'Crop with ratio presets (1:1, 4:3, 16:9...) or exact sizes in pixels, centimetres or inches.':
    'قصّ بنسب جاهزة (1:1 و4:3 و16:9…) أو بأحجام دقيقة بالبكسل أو السنتيمتر أو البوصة.',
  'Rotate in quarter turns or any angle, and flip horizontally or vertically.':
    'دوّر بأرباع الدورة أو بأي زاوية، واقلب أفقيًا أو رأسيًا.',
  'Straighten: type an angle, or let pixels find the horizon, or draw a line along it.':
    'التسوية: اكتب زاوية، أو دع بكسلز يجد الأفق، أو ارسم خطًا عليه.',
  'Skew and four-point perspective fix leaning buildings and tilted documents.':
    'تصلح الإمالة والمنظور رباعي النقاط المباني المائلة والمستندات المائلة.',
  'Canvas size adds or removes space around the picture. Picture size resizes it.':
    'حجم اللوحة يضيف مساحة حول الصورة أو يزيلها. وحجم الصورة يغيّر حجمها نفسه.',
  'Transform steps are applied in the order you make them. The History list shows that order.':
    'تُطبَّق خطوات التحويل بالترتيب الذي تنفّذه. وتعرض قائمة السجل هذا الترتيب.',
  // --- adjust
  'Adjust: light, colour, detail': 'الضبط: الضوء واللون والتفاصيل',
  'The everyday fixes.': 'الإصلاحات اليومية.',
  'Light: Exposure, Contrast, Highlights, Shadows, Whites, Blacks.':
    'الضوء: التعريض والتباين والإضاءات العالية والظلال والبيض والسود.',
  'Colour: Temperature (warm / cool), Tint (green / magenta), Vibrance (boosts dull colours gently), Saturation.':
    'اللون: درجة الحرارة (دافئ / بارد)، والصبغة (أخضر / أرجواني)، والحيوية (تعزّز الألوان الباهتة بلطف)، والتشبّع.',
  'HSL: change Hue, Saturation and Lightness of eight colour ranges separately (for example make only the blues deeper).':
    'HSL: غيّر تدرّج اللون والتشبّع والإضاءة لثمانية نطاقات لونية كلٌّ على حدة (مثلًا اجعل الأزرق وحده أعمق).',
  'Curves and Levels: precise control of the tone range. Click a curve to add a point, drag it, and drag a point off to remove it.':
    'المنحنيات والمستويات: تحكّم دقيق في نطاق النغمات. انقر المنحنى لإضافة نقطة، واسحبها لتحريكها، واسحب نقطة إلى الخارج لإزالتها.',
  'Detail: Noise reduction (keeps edges), Blur, Sharpen (amount, radius, threshold).':
    'التفاصيل: تقليل الضجيج (مع الحفاظ على الحواف)، والتمويه، والشحذ (الكمية ونصف القطر والعتبة).',
  'Finish: Vignette (darken or lighten the corners) and Grain (film texture).':
    'اللمسة الأخيرة: التظليل الحافي (تعتيم الزوايا أو تفتيحها) والحبيبات (ملمس الفيلم).',
  'Double-click any slider to put it back to zero. You can also type an exact number.':
    'انقر أي شريط تمرير نقرًا مزدوجًا لإعادته إلى الصفر. ويمكنك أيضًا كتابة رقم دقيق.',
  'The preview and the exported file use matching maths, so what you see is what you get (they agree to within 1 level out of 255).':
    'تستخدم المعاينة والملف المصدَّر حسابات متطابقة، فما تراه هو ما تحصل عليه (يتفقان ضمن مستوى واحد من 255).',
  // --- eraser
  'Eraser: remove things': 'الممحاة: إزالة الأشياء',
  'Paint over it and it is gone.': 'ارسم فوقه فيختفي.',
  'Choose the Eraser (E).': 'اختر الممحاة (E).',
  'Paint over the thing you want removed. Hold Alt to rub paint out if you went too far.':
    'ارسم فوق الشيء الذي تريد إزالته. اضغط Alt لمسح الطلاء إن بالغت.',
  'Press Remove. The gap is filled in from the surrounding texture.':
    'اضغط «إزالة». يُملأ الفراغ من النسيج المحيط.',
  'Fast is quick; High quality takes longer and usually looks better.':
    'الوضع السريع أسرع؛ والجودة العالية تستغرق وقتًا أطول وتبدو غالبًا أفضل.',
  '"Grow edge" widens your painted area a little so shadows and soft edges go too. "Soften seam" blends the fill into its surroundings.':
    'يوسّع «توسيع الحافة» المنطقة المرسومة قليلًا لتزول الظلال والحواف الناعمة أيضًا. ويدمج «تنعيم الوصلة» التعبئة بما حولها.',
  '"Undo last removal" goes back to the version before.': 'يعيدك «تراجع عن آخر إزالة» إلى النسخة السابقة.',
  'It cannot invent something that was never there. It works best on small objects against a plain or textured background (wires, spots, people far away).':
    'لا يستطيع ابتكار شيء لم يكن موجودًا. ويعمل أفضل مع الأجسام الصغيرة على خلفية بسيطة أو منسوجة (أسلاك وبقع وأشخاص بعيدين).',
  // --- brush
  'Brush: paint light and colour': 'الفرشاة: ارسم الضوء واللون',
  'Dodge, burn, eyes, teeth.': 'تفتيح وتعتيم وعيون وأسنان.',
  'The Brush changes light or colour only where you paint. Pick an effect, set the size, then paint on the picture. You see the change as you paint.':
    'تغيّر الفرشاة الضوء أو اللون حيث ترسم فقط. اختر تأثيرًا، واضبط الحجم، ثم ارسم على الصورة. ترى التغيير أثناء الرسم.',
  'Dodge lightens. Burn darkens.': 'التفتيح يفتّح، والتعتيم يعتّم.',
  'Brighten eyes adds a little light and contrast. Whiten teeth removes yellow and brightens.':
    'إنارة العينين تضيف قليلًا من الضوء والتباين. وتبييض الأسنان يزيل الاصفرار ويفتّح.',
  'Warm glow, Soften and Blur are for mood and for hiding detail.':
    'التوهّج الدافئ والتنعيم والتمويه للأجواء ولإخفاء التفاصيل.',
  'Size, Hardness (how sharp the brush edge is), Flow (how fast paint builds up) and Strength (how strong the effect is).':
    'الحجم، والصلابة (مدى حدة حافة الفرشاة)، والتدفق (سرعة تراكم الطلاء)، والقوة (شدة التأثير).',
  'Hold Alt to rub paint out.': 'اضغط Alt لمسح الطلاء.',
  'pixels does not find faces or eyes by itself. You choose where to paint. Each painted area is a "local adjustment": you can fine-tune its light and colour later under Local adjustments in the Inspector.':
    'لا يكتشف بكسلز الوجوه أو العيون بنفسه. أنت من يختار مكان الرسم. وكل منطقة مرسومة هي «تعديل موضعي»: يمكنك ضبط ضوئها ولونها لاحقًا من قسم التعديلات الموضعية في لوحة الخصائص.',
  'Use a low Flow and paint in several passes for natural results.':
    'استخدم تدفقًا منخفضًا وارسم على عدة مرّات للحصول على نتائج طبيعية.',
  // --- clone
  'Clone: copy one part onto another': 'الاستنساخ: انسخ جزءًا فوق جزء',
  'Remove blemishes, extend textures.': 'أزل العيوب وامدد الأنسجة.',
  'Choose Clone (S).': 'اختر الاستنساخ (S).',
  'Hold Alt and click the place you want to copy from. A small cross marks it.':
    'اضغط Alt وانقر المكان الذي تريد النسخ منه. تظهر علامة + صغيرة عليه.',
  'Release Alt and paint where the copy should go.': 'اترك Alt وارسم حيث يجب أن تظهر النسخة.',
  'The distance between source and where you paint stays the same for later strokes, so you can keep painting across an area. Alt+click again to choose a new source.':
    'تبقى المسافة بين المصدر ومكان الرسم ثابتة في الضربات اللاحقة، فيمكنك متابعة الرسم عبر المنطقة. اضغط Alt مع النقر مجددًا لاختيار مصدر جديد.',
  '"Forget source" clears it. "Clear all clones" removes every clone stroke.':
    'يمسح «نسيان المصدر» المصدر. ويزيل «مسح كل الاستنساخات» كل ضربات الاستنساخ.',
  'Clone strokes are applied before your other adjustments, so colour changes still apply on top.':
    'تُطبَّق ضربات الاستنساخ قبل بقية تعديلاتك، فتبقى تغييرات اللون مطبّقة فوقها.',
  // --- retouch
  'Retouch: heal, smooth, cut out': 'التنقيح: معالجة وتنعيم وقص',
  'Spots, skin, plain backgrounds.': 'البقع والبشرة والخلفيات البسيطة.',
  'Heal spots: paint over a spot or blemish and press Heal. It is filled from the area around it.':
    'معالجة البقع: ارسم فوق بقعة أو عيب واضغط «معالجة». تُملأ من المنطقة المحيطة بها.',
  'Smooth skin softens skin while keeping eyes, hair and edges sharp.':
    'تنعيم البشرة يلطّف البشرة مع إبقاء العيون والشعر والحواف حادّة.',
  'Remove background cuts out a plain background (a studio shot, a screenshot) and leaves it transparent, with a soft edge you can adjust.':
    'إزالة الخلفية تقصّ الخلفية البسيطة (صورة استوديو أو لقطة شاشة) وتتركها شفافة، بحافة ناعمة يمكنك ضبطها.',
  'Remove background works best when the background is one even colour. A busy background will not cut out cleanly.':
    'تعمل إزالة الخلفية أفضل حين تكون الخلفية بلون واحد موحّد. أما الخلفية المزدحمة فلن تُقص بنظافة.',
  // --- pixel art, upscale
  'Pixel Art': 'فن البكسل',
  'Turn any picture into pixel art.': 'حوّل أي صورة إلى فن بكسل.',
  'Pixel size: how big each "pixel" is in the picture.': 'حجم البكسل: مدى كبر كل «بكسل» في الصورة.',
  'Palette: Automatic (picked from the picture), or classic sets: Game Boy, PICO-8, NES, Commodore 64, CGA, Endesga 32. You can also import your own .hex or .gpl palette.':
    'لوحة الألوان: تلقائية (تُختار من الصورة)، أو مجموعات كلاسيكية: Game Boy وPICO-8 وNES وCommodore 64 وCGA وEndesga 32. ويمكنك أيضًا استيراد لوحتك بصيغة .hex أو .gpl.',
  'Dithering (ordered 2/4/8, Floyd-Steinberg, Atkinson) simulates more colours with patterns of dots.':
    'يحاكي التنقيط (مرتّب 2/4/8، وفلويد-شتاينبرغ، وأتكينسون) ألوانًا أكثر بأنماط من النقاط.',
  'Outline draws a border around shapes.': 'يرسم الإطار الخارجي حدًّا حول الأشكال.',
  'Export as the tiny 1x sprite, or scaled up with crisp blocks.':
    'صدّر الصورة الصغيرة بحجم 1×، أو مكبّرة بكتل حادة.',
  'Make a picture bigger.': 'كبّر الصورة.',
  'Enlarges up to 4 times with high-quality resampling and a careful sharpening pass that avoids bright or dark halos around edges.':
    'يكبّر حتى 4 أضعاف بإعادة أخذ عيّنات عالية الجودة ومرحلة شحذ حذرة تتجنب الهالات الساطعة أو المعتمة حول الحواف.',
  'Honest limit: it cannot add detail that was never in the picture. A small, blurry photo will be a bigger blurry photo, only cleaner.':
    'حدٌّ صريح: لا يمكنه إضافة تفاصيل لم تكن في الصورة. الصورة الصغيرة الضبابية ستصبح صورة ضبابية أكبر، لكن أنظف.',
  // --- selection, local, layers, text
  'Selection: limit the adjustments': 'التحديد: حصر التعديلات',
  'Edit only one area.': 'عدّل منطقة واحدة فقط.',
  'Open Selection in the Inspector. Choose Rectangle or Ellipse and set its position and size with the sliders. The Adjust edits (light, colour, curves, sharpen...) then apply only inside it.':
    'افتح قسم التحديد في لوحة الخصائص. اختر مستطيلًا أو قطعًا ناقصًا واضبط موضعه وحجمه بأشرطة التمرير. عندها تُطبَّق تعديلات الضبط (الضوء واللون والمنحنيات والشحذ…) داخله فقط.',
  'Feather softens the edge so the change fades in gradually.':
    'يلطّف التنعيم الحافة فيظهر التغيير تدريجيًا.',
  'Invert applies the edit to everything except the area.': 'العكس يطبّق التعديل على كل شيء عدا المنطقة.',
  'Choose "None" to go back to the whole picture.': 'اختر «بلا» للعودة إلى الصورة كاملة.',
  'For a free shape, use the Lasso tool (L): drag around the area and let go. The shape closes and becomes the selection.':
    'للشكل الحر، استخدم أداة المحدِّد الحر (L): اسحب حول المنطقة ثم أفلت. يُغلق الشكل ويصبح هو التحديد.',
  'Graduated and radial filters.': 'المرشّحات المتدرجة والدائرية.',
  'Local adjustments change light and colour only where a gradient is strong. Use them to darken a bright sky or to lift a face.':
    'تغيّر التعديلات الموضعية الضوء واللون حيث يكون التدرّج قويًا فقط. استخدمها لتعتيم سماء ساطعة أو لإنارة وجه.',
  'Graduated: fades along a line (for example from the top of the picture down to the middle).':
    'المتدرّج: يتلاشى على امتداد خط (مثلًا من أعلى الصورة نزولًا إلى منتصفها).',
  'Radial: strongest in the middle, fading towards the edges. Tick Invert to affect the outside instead.':
    'الدائري: أقوى في الوسط ويتلاشى نحو الحواف. فعّل «عكس» ليؤثر في الخارج بدلًا من ذلك.',
  'Move the start and end points with the sliders. Then set Exposure, Contrast, Highlights, Shadows, Temperature, Tint, Vibrance, Saturation and Blur for that area.':
    'حرّك نقطتي البداية والنهاية بأشرطة التمرير. ثم اضبط التعريض والتباين والإضاءات العالية والظلال ودرجة الحرارة والصبغة والحيوية والتشبّع والتمويه لتلك المنطقة.',
  'You can stack up to 8. Use the eye icon to hide one and the bin to delete it.':
    'يمكنك تكديس حتى 8. استخدم أيقونة العين لإخفاء واحد وسلة المهملات لحذفه.',
  'Areas you paint with the Brush also appear here.': 'المناطق التي ترسمها بالفرشاة تظهر هنا أيضًا.',
  Layers: 'الطبقات',
  'Pictures stacked on top of each other.': 'صور مكدّسة فوق بعضها.',
  'Open Layers in the Inspector and press Add layer. Choose another picture. It goes through the same security checks as any file.':
    'افتح قسم الطبقات في لوحة الخصائص واضغط «إضافة طبقة». اختر صورة أخرى. تمرّ بفحوصات الأمان نفسها كأي ملف.',
  'Select the layer in the list. Set Opacity, Blend, Size, and the X / Y position.':
    'حدّد الطبقة في القائمة. اضبط العتامة والمزج والحجم والموضع س / ص.',
  'Use the arrows to move a layer up or down the stack. The list shows the top layer first.':
    'استخدم الأسهم لرفع الطبقة أو خفضها في الترتيب. تعرض القائمة الطبقة العليا أولًا.',
  'To place it with the mouse, choose the Move tool (M) and drag the selected layer on the picture. Arrow keys nudge it by 1 pixel (10 with Shift).':
    'لتضعها بالفأرة، اختر أداة التحريك (M) واسحب الطبقة المحددة على الصورة. مفاتيح الأسهم تزيحها بمقدار بكسل واحد (10 مع Shift).',
  'Blend modes: Normal, Multiply (darkens, good for shadows), Screen (lightens, good for glows), Overlay and Soft light (add contrast), Darken, Lighten, Difference.':
    'أنماط المزج: عادي، وضرب (يعتّم، مناسب للظلال)، وشاشة (يفتّح، مناسب للتوهّج)، وتراكب وضوء ناعم (يضيفان تباينًا)، وتعتيم، وتفتيح، وفرق.',
  'Fade: make a layer fade out along a line (Linear) or from its centre (Radial) instead of ending sharply.':
    'التلاشي: اجعل الطبقة تتلاشى على امتداد خط (خطي) أو من مركزها (دائري) بدل أن تنتهي بحدّة.',
  'You can have up to 16 layers. Layer pictures are saved inside project files.':
    'يمكنك امتلاك حتى 16 طبقة. وتُحفظ صور الطبقات داخل ملفات المشاريع.',
  'Hide a layer with the eye icon to compare with and without it.':
    'أخفِ طبقة بأيقونة العين لتقارن بوجودها وبدونها.',
  'Text and shapes': 'النصوص والأشكال',
  'Add words, boxes, circles and lines.': 'أضف كلمات ومربعات ودوائر وخطوطًا.',
  'Open "Text & shapes" in the Inspector.': 'افتح قسم «نصوص وأشكال» في لوحة الخصائص.',
  'Type your text, choose a font, size and colour, then press Add text layer. Or choose a shape, set its size, and press Add shape layer.':
    'اكتب نصك، واختر الخط والحجم واللون، ثم اضغط «إضافة طبقة نص». أو اختر شكلًا واضبط حجمه واضغط «إضافة طبقة شكل».',
  'The new item is a layer. Select it in Layers to move it (X / Y), resize it, fade it or change its blend mode.':
    'العنصر الجديد طبقة. حدّده في قسم الطبقات لتحريكه (س / ص) أو تغيير حجمه أو تلاشيه أو نمط مزجه.',
  'To change the text later, delete the layer and add it again. A text layer is a picture of the text, so it keeps the same look on every computer.':
    'لتغيير النص لاحقًا، احذف الطبقة وأضفها من جديد. طبقة النص صورة للنص، لذلك يبقى مظهرها نفسه على كل جهاز.',
  // --- saving
  'Saving and exporting': 'الحفظ والتصدير',
  'Pictures, icon sets, projects, batches.': 'الصور ومجموعات الأيقونات والمشاريع والدفعات.',
  'Export: PNG, JPEG, WebP, AVIF or TIFF. Pick 8 or 16 bit and sRGB or Display P3 colour. You can set the print resolution (DPI) and quality.':
    'التصدير: PNG أو JPEG أو WebP أو AVIF أو TIFF. اختر 8 أو 16 بت وألوان sRGB أو Display P3. ويمكنك ضبط دقة الطباعة (نقطة لكل بوصة) والجودة.',
  'JPEG has no transparency, so transparent areas are filled with a colour you choose.':
    'صيغة JPEG لا تدعم الشفافية، لذلك تُملأ المناطق الشفافة بلون تختاره.',
  'Save project writes a .pxe file with your picture, every edit step and your layers. Open it later (or drop it on the window) to carry on exactly where you stopped.':
    'يكتب «حفظ المشروع» ملفًا بصيغة .pxe يضم صورتك وكل خطوة تعديل وطبقاتك. افتحه لاحقًا (أو أفلته على النافذة) لتتابع من حيث توقفت تمامًا.',
  'Presets: app icon sets (iOS, Android, macOS, Windows, favicons, web app), and store and social sizes (App Store, Google Play, Open Graph, X, LinkedIn, Instagram, YouTube, Facebook).':
    'القوالب الجاهزة: مجموعات أيقونات التطبيقات (iOS وأندرويد وماك وويندوز وأيقونات المواقع وتطبيق الويب)، وأحجام المتاجر والتواصل (App Store وGoogle Play وOpen Graph وX وLinkedIn وInstagram وYouTube وFacebook).',
  'Batch recipes: save a set of settings once and apply it to many pictures. You get a ZIP with a report of what the security check found in each file.':
    'وصفات الدفعات: احفظ مجموعة إعدادات مرة واحدة وطبّقها على صور كثيرة. تحصل على ملف ZIP مع تقرير بما وجده فحص الأمان في كل ملف.',
  'A project file is checked like any other file when you open it, including the pictures inside it.':
    'يُفحص ملف المشروع كأي ملف آخر عند فتحه، بما في ذلك الصور داخله.',
  // --- shortcuts and problems
  'Keyboard shortcuts': 'اختصارات لوحة المفاتيح',
  'The ones you will use most.': 'أكثرها استخدامًا.',
  'Save the project': 'حفظ المشروع',
  'This guide': 'هذا الدليل',
  'All keyboard shortcuts': 'كل اختصارات لوحة المفاتيح',
  'Select, Move, Lasso, Transform, Adjust, Eraser, Brush, Draw, Pen, Liquify, Clone, Retouch, Pixel Art, Upscale, Presets':
    'تحديد، تحريك، المحدِّد الحر، تحويل، ضبط، ممحاة، فرشاة، رسم، قلم، تشكيل، استنساخ، تنقيح، فن البكسل، تكبير الدقة، قوالب جاهزة',
  'Draw: write and draw in any colour': 'الرسم: اكتب وارسم بأي لون',
  'Pen, marker, highlighter, any colour.': 'قلم، ماركر، قلم تظليل، بأي لون.',
  'Draw or write by hand on the picture with the mouse, a finger or a pen. Pick a brush and a colour, then draw. Add it as a layer when you are done; leaving the tool adds it for you.':
    'ارسم أو اكتب بيدك على الصورة بالفأرة أو بإصبعك أو بالقلم. اختر الفرشاة واللون ثم ارسم. أضفه طبقةً عند الانتهاء؛ ترك الأداة يضيفه تلقائيًا.',
  'Pen: smooth ink; with a pen or stylus, pressing harder draws thicker.':
    'القلم: حبر ناعم؛ مع القلم الرقمي يصبح الخط أعرض كلما ضغطت أكثر.',
  'Marker: an even line that does not darken where it crosses itself. Highlighter: a flat, see-through line.':
    'الماركر: خط متساوٍ لا يغمق عند مروره فوق نفسه. قلم التظليل: خط مسطّح شفاف.',
  'Colour: tap a quick colour, or open the picker for any colour: spectrum, numbers, names in Arabic and English, or the eyedropper.':
    'اللون: اختر لونًا سريعًا، أو افتح منتقي الألوان لأي لون: الطيف، أو الأرقام، أو الأسماء بالعربية والإنجليزية، أو قطّارة الألوان.',
  'Undo stroke, Redo and Clear work on the drawing until it becomes a layer.':
    'التراجع عن الخط والإعادة والمسح تعمل على الرسم حتى يصبح طبقة.',
  'Raise Smoothing for steadier handwriting with a mouse.': 'ارفع التنعيم لكتابة أثبت بالفأرة.',
  '\\ (hold)': '\\ (مع الاستمرار)',
  'Show the original': 'عرض الأصل',
  'Space + drag': 'المسافة + سحب',
  'Move around the picture': 'التنقل في الصورة',
  'Alt (while painting)': 'Alt (أثناء الرسم)',
  'Rub paint out (Eraser, Brush)': 'مسح الطلاء (الممحاة والفرشاة)',
  'Alt + click (Clone)': 'Alt + نقر (الاستنساخ)',
  'Choose the source': 'اختيار المصدر',
  'Problems and answers': 'مشكلات وإجابات',
  'If something looks wrong.': 'إذا بدا شيء غير صحيح.',
  '"My picture was not opened": the message says why. Common reasons: the file is too large, its type does not match its name, or it failed a security check.':
    '«لم تُفتح صورتي»: تذكر الرسالة السبب. من الأسباب الشائعة: الملف كبير جدًا، أو نوعه لا يطابق اسمه، أو رسب في فحص أمني.',
  '"ClamAV is not running": the extra malware scan is skipped. Everything else still runs. This is not an error.':
    '«برنامج ClamAV غير مشغَّل»: يُتخطّى فحص البرمجيات الخبيثة الإضافي، وتعمل بقية الفحوصات. هذا ليس خطأ.',
  '"The preview looks soft": raise Preview quality in the top bar. Export is always full quality.':
    '«المعاينة تبدو ناعمة»: ارفع جودة المعاينة من الشريط العلوي. أما التصدير فبأقصى جودة دائمًا.',
  '"A tool is greyed out": it needs an open picture.': '«الأداة معتّمة»: تحتاج إلى صورة مفتوحة.',
  '"I painted but nothing changed": make sure the Strength is not zero and you are painting on the picture, not the grey area around it.':
    '«رسمت ولم يتغير شيء»: تأكد أن القوة ليست صفرًا وأنك ترسم على الصورة لا على المنطقة الرمادية حولها.',
  '"I lost my edits": press Ctrl+Z, or click an earlier step in History. Save a project to keep your steps for later.':
    '«ضاعت تعديلاتي»: اضغط Ctrl+Z، أو انقر خطوة سابقة في السجل. احفظ مشروعًا للاحتفاظ بخطواتك لوقت لاحق.',
  'What pixels does not do: it has no AI features (no generative fill, no automatic subject detection, no AI upscaling), no RAW camera files, and no CMYK print colour. These are deliberate or not built yet.':
    'ما لا يفعله بكسلز: ليس فيه ميزات ذكاء اصطناعي (لا تعبئة توليدية، ولا كشف تلقائي للموضوع، ولا تكبير بالذكاء الاصطناعي)، ولا ملفات RAW من الكاميرات، ولا ألوان الطباعة CMYK. وهذه إما مقصودة أو لم تُبنَ بعد.',
  'Tip:': 'نصيحة:',
  'User guide': 'دليل الاستخدام',
  'Search the guide (for example: blur, undo, export)': 'ابحث في الدليل (مثلًا: تمويه، تراجع، تصدير)',
  'Search the guide': 'ابحث في الدليل',
  'Close the guide': 'إغلاق الدليل',
  'Guide sections': 'أقسام الدليل',
  'Nothing matches that. Try one word.': 'لا شيء يطابق ذلك. جرّب كلمة واحدة.',
}

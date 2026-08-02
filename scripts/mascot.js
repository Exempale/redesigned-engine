// mascot.js

let bricked = localStorage.getItem('mascotBricked')
let handHolding = localStorage.getItem('handHolding')

let hhPhrases = [];
let hhSecondary = [];
let guestStep = 0
let currentPage = 'feed';
let pageData = null;
let profileIndex = 0;
let communityIndex = 0;
let firstClick = true;
let eventOne = ``
let eventTwo = ``
let choiceOne = ``
let choiceTwo = ``
const videoBlobCache = new Map();
const CACHE_NAME = 'mascot-video-cache-v1';

async function getCachedVideoUrl(url) { 
    if (videoBlobCache.has(url)) {
        return videoBlobCache.get(url);
    }

    try {
        const cache = await caches.open(CACHE_NAME);
        let response = await cache.match(url);

        if (!response) {
            response = await fetch(url);
            cache.put(url, response.clone());
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        videoBlobCache.set(url, objectUrl);
        return objectUrl;

    } catch (err) {
        console.warn('Failed to load cached mascot video, falling back to server URL:', err);
        return url;
    }
}

async function precacheAllMascotVideos() {
    const videoPaths = Object.values(emotionMap);
    await Promise.all(videoPaths.map(path => getCachedVideoUrl(path)));
}

const phrases = {
	"greetings": [
		"ПРИВЕТ ${username}!!",
		"ХАЙЙЙ ПРИВ ${username}!!=D",
		"ПРИВКИ ${username}!!",
		"ЙОУ ${username}!! ^^",
		"КОННИЧИВА ${username}!!",
		"НИХАВА ${username}!!",
		"ААААА ${username}!! =3"
	],
	"poke": [
		"АЙ XwX",
		"ХИХИ",
		"ЩЕКОТНО",
		"АХАХХ11!!",
		"ПРЕКРАТИИ-",
		">///<",
		"ААААА"
	],
	"random": [
		"/E6/Я ЛЮБЛЮ ФОРТПОРт!!1",
		"ДОМАШКА ОТСТОЙ!! ХОЧУ КУШАТЬ ПИЦЦУ И ГУЛЯТЬ!!! QwQ",
		"ТЫ ЗНАЛ ЧТО ДНО БАССЕЙНА ПАХНЕТ ШОКОЛАДОМ?? Я ПРОВЕРЯЛА!!!",
		"#ЩАСБЫ",
		"КЕКС ПОДАРИЛ УКРОПУ ДИСК",
    		"В СМЫСЛЕ ТЕТО 31?! 0_0",
    		"ОЙ, А МЫ С РОДИТЕЛЯМИ В КИНО СКОРО ПОЙДЁМ! но я уже забыла что за фильм...",
    		"КУДА ПРОПАДАЕТ 29 ФЕВРАЛЯ?!",
    		"СКОЛЬКО МЕСЯЦЕВ В ИЮЛЕ?",
    		"/E1/Я ПЫТАЛАСЬ КРАСИТЬСЯ ПО СОВЕТАМ КАТИ КЛЭП И РАЗБИЛА МАМИНЫ ТЕНИ T_T",
    		"БЛЕСК ДЛЯ ГУБ С АЛИ ЭКСПРЕССА ТАКОЙ ВКУСНЫЙ! правда он не смывается...",
    		"ШКОЛА САДИК УНИВЕР Я НЕ ЗАКОНЧИЛА ЕЩЁ",
    		"/E7/ПОЧЕМУ ХОТВИЛС МАШИНКИ ТАКИЕ ДОРОГИЕ? Я НЕ МИЛЛИОНЕР!1!!1",
    		"/E5/ПОЧЕМУ НЕТ ИГРЫ, ГДЕ СУДОКУ ИГРАЕТ В ФУТБОЛ?",
    		"/E5/ПОЧЕМУ НЕТ ИГРЫ, ГДЕ ТЫ ТИПО НУ... блин, я забыла в чём шутка...",
    		"/E5/ВОПРОС-ОТВЕТ? А КТО СПРАШИВАЕТ?",
    		"АНАПА 2006",
    		"СОЧИ 2014",
    		"/E7/Я ПОСТОЯННО ПРОСЫПАЮ СВОИ ОСТАНОВКИ. ЭТО ТАК БЕСИТ!1!1!1!2",
    		"МНЕ СРОЧНО НУЖНА ФУТБОЛКА С ФЛАГОМ БРИТАНИИ! ЗАЧЕМ? НЕ ВАЖНО!1!1!1!",
    		"МЕТРО 2033? А ПОЧЕМУ НЕ ВОКЗАЛ 2027?",
    		"ХИ БРОУК МАЙ ХАРТ...",
    		"/E5/КАК ЛЮДИ РИСУЮТ ВО ФЛИПАКЛИПЕ?!?!1?1??!",
   		"ЯЛТА, АВГУСТ...",
   		"ДОКТОР КТО? ПОЖАРНЫЙ ЧТО?",
   		"/E5/КТО ТАКИЕ ЦУНДЕРЕ?",
   		"/E4/А Я НАГГЕТСЫ ХОЧУ",
   		"/E4/ВТОРОЕ ПРАВИЛО БОЙЦОВСКОГО КЛУБА? Я И ПЕРВОЕ НЕ ПОМНЮ",
   		"ПРИВЕТ МЕДВЕД XD",
   		"Я ДУМАЮ, ЧТО Я ПОХОЖА НА КОНСОЛЬ WII. ПАПА СЧИТАЕТ, ЧТО МНЕ ПОРА СПАТЬ",
   		"У МЕНЯ ЕСТЬ СКЕТЧБУК!1!1!1! ПОКАЗАТЬ? МОЖЕТ ПОЗЖЕ...",
   		"ВНИМАНИЕ! ЗАВТРА БУДЕТ СЛЕДУЮЩИЙ ДЕНЬ",
   		"ГДЕ ТЫ, А Я ВООБЩЕ ГДЕ?!",
   		"CHIWAWA!",
		"PUPUE!1!1!1!1!1",
    		"/E5/ОДНАЖДЫ МЫ С ПАПОЙ ПОССОРИЛИСЬ КТО НА САМОМ ДЕЛЕ ПИРАМИДАГОЛОВЫЙ. ОН ГОВОРИЛ, ЧТО ЭТО ДЖЕЙМС, НО Я ВСЁ ЕЩЁ СЧИТАЮ, ЧТО ЭТО ТОЙ ЧИКА",
     		"ТУ ОЛ ОФ Ю... АМЕРИКАН ГЁРЛ ИТС СЭД ТУ",
     		"СОВУШКИ :3",
     		"ПАРОЛЬ ОТ ТЕЛЕФОНА? 838995! ЧТО ЭТО ЗНАЧИТ? ПОНЯТИЯ НЕ ИМЕЮ :D",
     		"/E5/ ДЖЕЙМС ИЛИ ГАРРИ? МНЕ БОЛЬШЕ ГОРДОН ФРИМЕН НРАВИТСЯ...",
     		"/E5/Зачем бить крапиву палкой?... Никогда не понимала...",
     		"КАГАМИ ТАКАЯ МИЛАШКА, КОГДА СПИТ :3",
     		"/E7/ДА КАК КУШАТЬ ЭТИ КРЕМОВЫЕ РОГАЛИКИ?!",
     		"/E5/ЭДМУНД МАК... КТО? ТАКИХ НЕ ЗНАЮ :^",
     		"ПЕСНЬ САИ? У ЭТОЙ ПРОГРАММЫ ЕСТЬ ПЕСНИ?! 0_0",
     		"АМИНО? ЧТО-ТО ЗНАКОМОЕ...",
     		"WHAT FLAVOR? PIE PIE PIE!",
     		"У МЕНЯ МНОГО СКЕТЧБУКОВ, НО Я ПОСТОЯННО ЗАБЫВАЮ ОБ ИХ СУЩЕСТВОВАНИИ :_)", 
     		"/E6/Я ОЧЕНЬ ХОЧУ ФИГУРКУ КОНАТЫ НА ДЕНЬ РОЖДЕНИЯ",
     		"/E6/ЭТИ ГЛАЗКИ, ЭТИ ЗЕЛЁНЫЕ ГЛАЗКИ...",
     		"/E5/СУПЕР СОНИКО? А ЕСТЬ СУПЕР ТЕЙЛЗО?",
     		"Я ХОЧУ ЗАВЕСТИ ТРЁХЦВЕТНОГО КОТИКА И НАЗВАТЬ ЕГО КУКИ!",
     		"/E6/МОИ РОДИТЕЛИ ЧАСТО ГОВОРЯТ, ЧТО ЛЮБЯТ МЕНЯ!",
     		"I GOT SECRET I WON'T TELL!",
     		"/E6/Я ЛЮБЛЮ ИНТЕРНЕТ!!",
     		"/E6/Я ЛЮБЛЮ ФЛЕШ ИГРЫ!!",
     		"/E6/Я ЛЮБЛЮ ЧАТИКИ!!",
     		"УЛИТКА БОБ ТАКАЯ СЛОЖНАЯ ИГРА!! Я НЕ МОГУ ЕЁ ПРОЙТИ QwQ",
     		"/E5/Кто такие ларперы...",
     		"/E5/ПОЧЕМУ ИГРА НАЗЫВАЕТСЯ JACKSMITH ЕСЛИ КУЗНЕЦ НА АНГЛИЙСКОМ ЭТО GRASSHOPPER?!??",
     		"КИЯЙ, КИЯЙ, КИЯЙ, КИЯЙ ДАЙОО!",
     		"ПЕРЕОДЕВАЛКИ С ВИНКС ТАКИЕ ОДНОТИПНЫЕ! ГДЕ ПЕРЕОДЕВАЛКА С ГОРДОНОМ ФРИМЕНОМ??!!!",
     		"/E5/Для просмотра этого содержимого требуется проигрыватель Adobe Flash Player...",
     		"/E5/Установите или включите Adobe Flash Player для просмотра этого контента...",
     		"ВСМЫСЛЕ ФЛЕШ СКОРО ПЕРЕСТАНЕТ РАБОТАТЬ???",
     		"/E5/Что такое Ruffle...",
     		"/E6/Шедоу такой крутой...",
     		"Я КАТАЛАСЬ НА СКЕЙТЕ ОДИН РАЗ, ВСЕ ЧАСТИ СКЕЙТА ТАК И НЕ НАШЛИ!!",
     		"/E6/А МНЕ НРАВИТСЯ КАТАТЬСЯ НА РОЛИКАХ",
     		"А НА УЛИЦЕ ХОРОШО ГУЛЯТЬ!!",
     		"Я ПЫТАЛАСЬ АНИМИРОВАТЬ В МАКРОМЕДИА ФЛЕШ НО ОН ЗАВИС И ВЫЛЕТЕЛ!!",
     		"ФортПорт против насилия!!",
     		"ФортПорт за мир во всём мире!!",
     		"/E7/ОН БИЛЛ САЙФЕР А НЕ ШИФЕР!!!",
     		"/E6/Я ХОЧУ СЕБЕ СВИНКУ КАК ПУХЛЮ!!",
     		"/E5/ПОЧЕМУ ДИППЕР НЕ ПОКАЗАЛ ДНЕВНИК СТЭНУ РАНЬШЕ?!",
     		"/E5/А где Геленджик...",
     		"/E6/ЧТОБЫ ВСТРЕЧАТЬСЯ СО МНОЙ, ТЕБЕ НАДО ОДОЛЕТЬ МОИ СЕМЕРО ЗЛЫХ БЫВШИХ-КИРПИЧЕЙ!!",
     		"МЕ ГУСТА",
     		"EPIC FACE!!!",
     		"/E5/А где Геленджик...",
     		"Я ПЫТАЛАСЬ ПОИГРАТЬ В МАЙНКРАФТ, НО МЕНЯ ЗАГРИФЕРИЛИ T_T",
     		"А МНЕ МАМА ЗАПРЕЩАЕТ СМОТРЕТЬ ГУБКУ БОБА",
     		"ХВОСТИКИ - ДРЕЛИ? Я НЕ ПОНИМАЮ О ЧЁМ РЕЧЬ! 0_0",
     		"МОЁ ЛЮБИМОЕ АНИМЕ? NYAN NEKO SUGAR GIRLS, КОНЕЧНО! :D",
    		"/E5/УМЕЮ ЛЮ Я ИГРАТЬ В КАРТЫ? УНО СЧИТАЕТСЯ? :^",
   		"/E5/МЬЮДЖЕНИКС ОПЯТЬ ОТМЕНИЛИ?!",
   		"А У МЕНЯ ЕСТЬ КОЛЛЕКЦИЯ БРАТЦ!1!1!1!",
   		"ЧЕЛОВЕК АМЕРИКА? Я НЕ ФАНАТЕЮ ОТ ТИМ ФОРТРЕСС",
   		"/E5/ПОЧЕМУ НЕЛЬЗЯ ВЫДАТЬ ВСЕМ НА ЗЕМЛЕ ПО МИЛЛИОНУ ДОЛЛАРОВ?",
   		"/E7/НЕТ, Я РОДНАЯ, ХВАТИТ СПРАШИВАТЬ!",
   		"ПС ВИТА? НУ, ОНИ ХОТЯ БЫ ПОПЫТАЛИСЬ...",
		"НА ВКУС И ЦВЕТ ВСЕ МЕЛКИ РАЗНЫЕ :D",
		"/E7/НЕ ВЕРЬТЕ НАДПИСЯМ НА ШАМПУНЕ, ОНИ НА ВКУС СОВСЕМ НЕ БАБЛ ГАМ((0(0(0(0",
		"КОГДА Я ВЫРАСТУ Я ХОЧУ БЫТЬ ЮТУБЕРОМ!!! OwO",
		"/E5/ТЫ СЛЫШАЛ О ТАКОМ КРУТОМ АНИМЕ ХВОСТ ФЕИ?? Я НЕТ =Д",
		"/E6/Я ЛЮБЛЮ ЩЕНЯТ!!!!",
		"/E6/Я ЛЮБЛЮ ПТИЧЕК!!!!",
		"/E5/КОГДА В МОЁМ ГОРОДЕ ТУМАН, ЭТО ПОХОЖЕ НА ОДНУ ИГРУ. ЗАБЫЛА ПРАВДА КАКОЮ...",
    		"УМЕЮ ЛИ Я ИГРАТЬ НА ПИАНИНО? КОНЕЧНО НЕТ :D",
    		"МОЙ ЛЮБИМЫЙ ЦВЕТ ГОЛУБОЙ. НЕ ДУМАЮ, ЧТО ЭТО ОЧЕВИДНО!!",
    		"/E7/НЕНАВИЖУ КОГДА У МЕНЯ БОЛИТ ГОЛОВА!",
    		"/E6/ОБОЖАЮ ГУЛЯТЬ НА УЛИЦЕ ВМЕСТЕ С РОДИТЕЛЯМИ",
    		"ВЕСНА ЛУЧШЕ ОСЕНИ!1!1!1!1",
    		"ПАЙТОН ИЛИ ПИТОН? Я НЕ ЗНАЮ :P",
    		"/E5/СКОЛЬКО МНЕ ЛЕТ? 1+1+1... БЛИН, СБИЛАСЬ",
    		"ОДНАЖДЫ Я ОТДЫХАЛА В СОЧИ!!! ПРАВДА НЕ ПОМНЮ КОГДА...",
    		"ЯБЛОКИ?",
    		"/E7/НА МОЁМ ТЕЛЕФОНЕ ОПЯТЬ ТРЕЩЕНА... Я НЕ СПЕЦИАЛЬНО УПАЛА И РАЗБИЛА ЕГО!1!1!1!",
    		"АЙАЙАЙ АЙМ ЁР ЛИТТЛ БАТТЕРФЛЯЙ :D",
    		"ПРОСНИТЕСЬ И ПОЙТЕ, МИСТЕР ФРИМЕН.",
    		"МОЙ ЛЮБИМЫЙ ПРЕДМЕТ? СТОЛ!",
    		"/E7/ НЕТ, Я НЕ ЕЛА ЗУБНУЮ ПАСТУ С ДРАКОНЧИКОМ, ЭТО ВСЁ ХОМА!",
    		"РЕЦЕПТ ПЛОВА! МЯСО, РИС, ЭЭЭ...",
    		"Я ЧАСТО ПЬЮ ИБУПРАФЕН",
		"ДРОГЕЛЬДЖАГ",
    		"/E5/ОДНАЖДЫ Я ЕЗДИЛА В ПОЕЗДЕ И ПОТЕРЯЛА ВСЕ СТОЛОВЫЕ ПРИБОРЫ. ИНТЕРЕСНО, ГДЕ ОНИ...",
    		"ХАНАМАНТАНА!!!",
    		"ХАКУНАМАТАТА!!!",
    		"/E7/Я НЕ СЛУШАЮ РАНЕТОК, ЭТО ВСЁ ВРАКИ!!!",
    		"ИНОГДА Я ДОБАВЛЯЮ СЛИШКОМ МНОГО САХАРА В ЧАЙ, ПОТОМУ ЧТО ЗАБЫВАЮ КЛАЛА ЛИ ЕГО УЖЕ",
    		"/E6/ПОШЛИ ГУЛЯТЬ!!!",
    		"ВЛАДИМЕРСКИЙ ЦЕНТРАЛ? ЭТО ГДЕ?",
    		"/E1/А Я СПРЯТАЛАСЬ!",
    		"ЧТО Я ТОЛЬКО ЧТО ГОВОРИЛА?",
    		"НЯМ:3",
    		"/E5/РОДИТЕЛИ СКАЗАЛИ, ЧТО МНЕ НЕЛЬЗЯ КОФЕ, НО ТЫ ЖЕ ИМ НЕ СКАЖЕШЬ?",
    		"/E1/АААААА!1!!1! ТАМ ПЧЕЛА!!!!",
    		"МНЕ БЫ ХОТЕЛОСЬ ИМЕТЬ БОЛЬШЕ ДРУЗЕЙ",
    		"/E6/ВЛЮБЛЕНА ЛИ Я? Н-НУ.. ГОРДОН ФРИМЕН СЧИТАЕТСЯ..???",
    		"МАМА, СКИНЬ ПОПИТЬ, Я НЕ ХОЧУ ПОДНИМАТЬСЯ ДОМОЙ!!!",
    		"БУДУЩЕЕ ПРЕКРАСНО!",
    		"В СМЫСЛЕ НА АЛИЭКСПРЕССЕ ЕСТЬ ПРОЗРАЧНЫЕ АЙФОНЫ?! МАМ!",
    		"ХОЧУ ФРИКАДЕЛЬКИ ИЗ ИКЕИ...",
    		"МОЙ ЛЮБИМЫЙ МОБ? ТОЙ БОННИ!!",
    		"/E7/Я НЕ КОСПЛЕЮ ХАТСУНЭ МИКУ!!! ЭТО ОНА КОСПЛЕИТ МЕНЯ!!",
		"ЭНД ИФ Ю ГОУ, Я ВАННА ГОУ ВИФ Ю",
    		"А ЧТО ЕСЛИ МОЙ ПАПА - ОСМИНОГ?",
    		"ВРЕМЯ ИГРАТЬ В ХЭППИ ВИЛЛС! :D",
    		"КОГДА НОВОЕ ОБНОВЛЕНИЕ ФОРТПОРТА? ПОНЯТИЯ НЕ ИМЕЮ :^",
     		"/E6/ELECTRIC ANGEL!",
     		"/E6/ХОЧУ НАУЧИТЬСЯ ПЛЕСТИ ФЕНЕЧКИ!",
    		"/E6/Я ПОЛЬЗУЮСЬ ШАМПУНЕМ С ПРИНЦЕССОЙ!!!",
    		"ИНОГДА МАМА КРАСИТ МНЕ НОГТИ КРАСИВЫМ ЛАКОМ, НО МНЕ ПЛОХО ОТ ЕГО ЗАПАХА...",
    		"Я ДУМАЮ, ЧТО ПОХОЖА НА ТЕКНУ БОЛЬШЕ, ЧЕМ НА БЛУМ",
    		"МНЕ НРАВЯТСЯ БРАУЗЕРНЫЕ ИГРЫ ИЗ-ЗА ИХ РАЗНОСТИ. ВОЗМОЖНО, Я ПРОСТО ЗАБЫВАЮ ВО ЧТО УЖЕ ИГРАЛА",
     		"ИГРЫ ПАПА ЛУИ ОЧЕНЬ СТРАННЫЕ... ПОЧЕМУ ПОСЕТИТЕЛИ ЖАЛУЮТСЯ ЧТО Я КЛАДУ ИМ 100 ПЕЧЕНЕК В КОФЕ!?",
    		"ЧИЧИЛАФФ ЧИЧИЛАФФ... ДОСТАЛА РЕКЛАМА!",
    		"МЫ ЛЮБИМ ЧУДЕСА И ЯРКИЕ КАРТИНКИ...",
    		"КАК НАЙТИ ПИГГСИ В ГТА?",
    		"ОХОТА НА МУЖИКА 3!",
    		"ОДНАЖДЫ Я ПОПРОБУЮ ТАБЛЕРОН... МОЖЕТ, КОГДА КУПЛЮ БИОНИКЛОВ",
    		"/E7/НЕЕЕТ, ПОЧЕМУ ЛЕО ВСТРЕЧАЕТСЯ С ЭЛЬЗОЙ?!",
    		"ЧУУУВАААААК!1!1!!1!1",
    		"ОЙ, МАМА ПРИШЛА...",
    		"БОРИС ЛОВ... БЭБИ ДОНТ ФЁРТ МИ",
    		"NEVER GONNA GIVE YOU UP!",
    		"/E6/А МНЕ МАМА ПОМОГАЕТ КРАСИТЬСЯ! что? Я не ношу макияжа..? ТАК Я НЕ ПРО НЕГО",
    		"МНЕ КАЖЕТСЯ МЕНЯ УВОЛИЛИ... ПРАВДА Я НЕ ПОМНЮ ГДЕ Я РАБОТАЛА :(",
    		"ТЫ СЛУЧАЙНО НЕ ВИДЕЛ МОЮ ЗАРЯДКУ? ОПЯТЬ ПОТЕРЯЛА...",
    		"ХОЛА АМИГОС! >:D",
    		"/E6/ПАПА ГОВОРИТ, ЧТО Я ПОХОЖА НА МАЛЕНЬКОГО КОТЁНКА. ТОЖЕ МАЛЕНЬКАЯ И ГЛУПЕНЬКАЯ!",
    		"/E5/НЕНАВИЖУ ЛИ Я КОГО-ТО? ТОЛЬКО ОВСЯНКУ",
    		"ВОТ БЫ СЕЙЧАС НА ПИКНИК ПОЙТИ...",
    		"НЛО ЛЕТИТ НА ЗЕМЛЮ!",
    		"/E5/ПОЧЕМУ ИГРЫ НА ПОИСК ПРЕДМЕТОВ ТАКИЕ СЛОЖНЫЕ?",
    		"/E6/Я НОРМАЛЬНО ПИШУ! НИЧЕГО Я НЕ КУРИЦА И НЕ ЛАПА!",
    		"БУ! ИСПУГАЛИСЬ?",
		"ЗАХОДЯТ В БАР ДВА МУЖИКА, И ЖЕНЩИНА. И ЗАКАЗЫВАЮТ ВЫПИТЬ.. дальше не помню...",
		"/E4/РАЗМЕРЫ КИРПИЧА: 250 НА 120 НА 65 МИЛЛИМЕТРОВ",
		"ГЕЙМЕРЫ ВСЕГО МИРА ВОССТАНЬТЕ!!!",
		"МОИ ДРУЗЬЯ СОСТОЯТ В КАКОЙ-ТО \"ЛЕГЕНДАРНОЙ ЛИГЕ\", ИНТЕРЕСНО КАКОГО ТАМ",
		"/E5/ЧТО ТАКОЕ ВАРКРАФТ. ПОЧЕМУ У НЕГО ЕСТЬ СВОЙ МИР",
		"СМОШ!",
		"/E6/А МЕНЯ ПАПА НАУЧИЛ ИГРАТЬ В СУДОКУ",
		"/E5/АЙЗЕК И ЕГО МАМА ЖИЛИ ОДНИ В МАЛЕНЬКОМ ДОМЕ НА ХОЛМЕ...",
		"/E5/КУДА ПРОПАЛА МОЯ СУМКА?!",
		"/E7/ХВАТИТ КИДАТЬ В МЕНЯ КИРПИЧИ!1!1!",
		"/E7/МНЕ ЗАПРЕТИЛИ ПИТЬ КОКА КОЛУ, ПОТОМУ ЧТО МАМА ЕЙ МОЕТ ТУАЛЕТЫ >:(",
		"Я ЛЮБЛЮ ПОЕЗДА :D",
		"ВРЕМЯ МАФФИНОВ",
		"ИДУТ КАК-ТО МАМА С СЫНОМ ПО УЛИЦЕ И РЕБЁНОК УВИДЕЛ ГОЛУБЯ...блин, забыла...",
		"У МЕНЯ НЕТ ПРОБЛЕМ С ПАМЯТЬЮ!1!1!1! QwQ",
		"Я ТОЧНО НЕ КИДАЛА ТЕЛЕВИЗОР ИЗ ОКНА! ЭТО ВСЁ ХОМА!!!",
		"ДВА ШАГА НАЗАД И ТРИ ШАГА ВПЕРЁД!!! ТАМ ТАК ПОЁТСЯ?",
		"/E5/ПОДОЖДИТЕ, ГДЕ МОИ КЛЮЧИ ОТ ДОМА?!?!",
		"ОТКУДА МНЕ ЗНАТЬ СКОЛЬКО БУДЕТ ШЕСТЬ УМНОЖИТЬ НА ТРИ?!",
		"КОГДА Я СТАНУ ЮТУБЕРОМ, Я ХОЧУ СДЕЛАТЬ ВИДЕО \"НАРИСУЙ СВОЮ ЖИЗНЬ\" :D",
		"А Я ПЬЮ НАШУ КОЛУ В ТАЙНЕ ОТ МАМЫ! ТОЛЬКО ЕЙ НЕ ГОВОРИТЕ... кола же и должна прожигать живот да...?",
		"Я ЛЮБЛЮ СВОИХ ДРУЗЕЙ! ВСЕХ ОДНОГО!!",
		"/E5/В СМЫСЛЕ ДЕДА МОРОЗА НЕ СУЩЕСТВУЕТ?",
		"МНЕ НУЖЕН РЮКЗАК С КОСМОСОМ! СРОЧНО!1!!!",
		"ХАЮ-ХАЙ, С ВАМИ ЖЕНЬКА",
		"НЕТ, У МЕНЯ НЕТ ТАМБЛЕРА :р",
		"Я ПЫТАЛАСЬ ОТОМСТИТЬ СНЕГОВИКУ И СЛОМАЛА НОГУ 0_0",
		"ВВЕРХ, ВВЕРХ, ВНИЗ, ВНИЗ, ВЛЕВО, ВПРАВО, ВЛЕВО, ВПРАВО, Б, А! ПОЧЕМУ НЕ РАБОТАЕТ?!",
		"MOTHERLODE! БЛИН, ВСЁ ЕЩЁ НЕ ХВАТАЕТ НА БИОНИКЛОВ(((0(0(((",
		"IT'S RAINING TACOS!1!!",
		"О НЕТ, НАУШНИКИ ОПЯТЬ СПУТАЛИСЬ T_T",
		"/E5/МНЕ НРАВИТСЯ ИГРАТЬ С СИМС, НО МОИ СИМы ПОСТОЯННО ТУПЯТ...",
		"Я ЛЮБЛЮ ФЛЕШ ИГРЫ!",
		"ВЫ БЫ НЕ МОГЛИ ПОДПИСАТЬ МОЮ ПЕТИЦИЮ? :D",
		"ПОЧЕМУ СЕНТЯБРЬ ГОРИТ? ГДЕ ПОЖАРНЫЕ?!",
		"ЁМАЁ, МАМА ЗВОНИТ!!",
		"МНЕ НРАВИТСЯ ПЛЕСТИ БРАСЛЕТИКИ ИЗ РЕЗИНОЧЕК! ХОЧЕШЬ ПОКАЖУ?",
		"МОЯ ЛЮБИМАЯ ПЕСНЯ ИЗ МАЙКРАФТА ЭТО MICE ON VENUS :O",
		"C418 ЛЕГЕНДА!!!",
		"/E7/ПОЧЕМУ ВСЕ ГОВОРЯТ, ЧТО Я ПОХОЖА НА ПИНКИ ПАЙ? МЫ НЕ ПОХОЖИ!!! >:(",
		"НЯНЯНЯНЯНЯНЯНЯНЯНЯНЯНЯ :3",
		"ЗОМБИ НА ТВОЕЙ ЛУЖАЙКЕ ААААА! 1!1!1!1 >_<",
		"МНЕ ДРУЗЬЯ ДАЛИ МНЕ ПОСЛУШАТЬ ИХ НОВЫЕ ДИСКИ!!!! =D",
		"ВЫШЕЛ НОВЫЙ ОБЗОР МОДОВ НА МАЙНКРАФТ! :D",
		"КОТЛЕТКИ С ПЮРЕШКОЙ... Я ОЧЕНЬ ГОЛОДНАЯ",
		"/E5/КРАСНАЯ ИЛИ СИНЯЯ ТАБЛЕТКА? :^",
		"БЫЛА У МЕНЯ ОДНАЖДЫ НЕКАЯ СИТУАЦИЯ...",
		"МЫ ВСЕ ЖИВЁМ В МАТРИЦЕ БУУУ >:)",
		"/E5/ИНТЕРЕСНО, А МОИ ИГРУШКИ ТОЖЕ ОЖИВАЮТ, ПОКА МЕНЯ НЕТ ИЛИ ЭТО ТОЛЬКО В АМЕРИКЕ?",
		"Я ЛЮБЛЮ ШАРЛОТКУ!!",
		"/E5/Я ПЫТАЛАСЬ СКАЧАТЬ ГТА, НО УСТАНОВИЛА ТОЛЬКО ВИРУСЫ...",
		"МЕХАНИКИ? КАЧАЙ!",
		"МОЙ ЛЮБИМЫЙ ЭТАП В СПОР ЭТО КЛЕТКА!!! ДАЛЬШЕ Я НЕ СМОГЛА ПРОЙТИ...",
		"ЛЮБИМАЯ КНИГА?? ПОЧИНКА!!",
		"ОНА ЖУЁТ СВОЙ ОРБИТ БЕЗ САХАРА...",
		"КАКОГО ЦВЕТА МОИ ГЛАЗА? ХОРОШИЙ ВОПРОС!",
		"/E7/КУРЮ ЛИ Я??? Я ДЕВОЧКА А НЕ КУРИЦА!!! >:[",
		"/E5/МНЕ НЕДАВНО СОН ТАКОЙ ПРИСНИЛСЯ... ЗАБЫЛА ПРАВДА КАКОЙ",
		"Я ПЫТАЛАСЬ ВЫЗВАТЬ СЛЕНДЕРМЕНА НОЧЬЮ, НО ПАПА УЗНАЛ ОБ ЭТОМ И НАРУГАЛ МЕНЯ",
		"САМЫЙ КРУТОЙ ДЕНЬ НЕДЕЛИ - ВТОРНИК",
		"ДЖЕФ УБИЙЦА ПРИДЁТ ЗА МНОЙ ААААА!1!1!1!1!1",
		"НА ФОРТПОРТЕ ЦЕЛЫХ ${totalports} ПОРТОВ! СТОЛЬКО ИНТЕРЕСНОГО!!",
		"НА ФОРТПОРТЕ ЦЕЛЫХ ${totalusers} ПОЛЬЗОВАТЕЛЕЙ!! СТОЛЬКО ДРУЗЕЙ!!",
		"Я ПОМНЮ ЧТО ХОТЕЛА ЧТО-ТО СКАЗАТЬ",
		"/E5/ЛАДНО Я НИЧЕГО НЕ ПОМНЮ",
		"ПРИВЕТ!!",
		"/E5/А ВЫ ЗНАЛЛИ ЧТО ЕСТЬ ТЕТРАДЬ В КОТОРУЮ ПИШЕШЬ ИМЯ ЧЕЛОВЕКА И В НЕГО ПРИЛЕТАЕТ КИРПИЧ??!",
		"/E5/В СМЫСЛЕ ИГРЫ НУЖНО ПОКУПАТЬ???",
		"МИШКА ФРЕДДИ ИДЁТ ЗА НАМИ АААА11!11!",
		"/E5/ГОВОРЯТ, ЧТО 3DS ЛУЧШЕ PSP... НО У МЕНЯ НЕТ ДЕНЕГ, ЧТОБЫ ПРОВЕРИТЬ :T",
		"УРААА!1!!1! 5 ДЕНЯК",
		"/E0/Я ПЫТАЛАСЬ СДЕЛАТЬ АЙС БАКЕТ ЧЕЛЕНДЖ И ЗАБОЛЕЛА (опять...) D:",
		"ХЕРОБРИН СУЩЕСТВУЕТ, Я САМА ВИДЕЛА!!!1!1",
		"БЛЕЙЗЕР ЭТО НЕ ВКУСНО! D:",
		"/E5/ВОТ БЫ У МЕНЯ БЫЛИ ДЕНЬГИ НА БИОНИКЛОВ...",
		"ШАШЛЫКИ!!!!!!",
		"/E5/ПО ЗАКОНУ АРХИМЕДА, ПОСЛЕ СЫТНОГО ОБЕДА... забыла...",
		"МНЕ НАЦАТЬ ЛЕТ!! СКОЛЬКО ЭТО? Я НЕ ЗНАЮ",
		"HESOYAM!! HESOYAM!! Почему ничего не происходит..??",
		"/E5/ИНТЕРЕСНО А В 2012-м И ПРАВДА КОНЕЦ СВЕТА..??",
		"РОКОЧУЩИЙ ОБРЫГЫЦАРЬ!!! ЕХЕХЕХЕ",
		"ЛУННАЯ ПРИЗМА ДАЙ МНЕ НЬЮТОНОВ!!",
		"СЕКАААААААЙ ДЕЕЕ ИЧИБАН НО ХИМЕ САМААААА",
		"Я БЕЗ ГМО, ЧЕСТНО ЧЕСТНО!!!",
		"/E7/МОЕГО РОСТА ХВАТАЕТ ЧТОБЫ КАТАТЬСЯ НА ГОРКАХ!!! ПРАВДА!!!",
		"/E6/МНЕ ХВОСТИКИ МАМА ЗАПЛЕТАЕТ",
		"СЫР КОСИЧКУ В СТУДИЮ!",
		"ДА ТЫ ЧЁ?! БЛИИИИИН!!!",
		"НИЧОСИ!!!",
		"/E5/ИНТЕРЕСНО, А МЯСНОЙ ПАЦАН ВКУСНЫЙ? :^",
		"БЕДНЫЙ ХОМА T_T...",
		"Я УМЕЮ ГОТОВИТЬ ГОРЯЧИЕ БУТЕРБРОДЫ!1! 1!(ПОЧТИ)",
		"/E7/МАМА, Я ПОЕЛА, НЕ КРИЧИ НА МЕНЯ >_<",
		"/E7/Я ПЕРЕХОЖУ ТОЛЬКО НА ЗЕЛЁНЫЙ, НО МЕНЯ ВСЁ РАВНО СБИВАЮТ >:(",
		"КУПИТЕ МНЕ БРЕЛОЧКИ!1!1!1!1",
		"/E5/МЫ ВСЕ УМЕРЛИ В 2012?",
		"ФОРТПОРТ ЛУЧШЕ АСЬКИ >:D",
		"/E4/Хуана уволили, кстати",
		"/E4/Я люблю кричать так люди чаще меня слушают",
		"ВСЕМ ПРИВЕТ Я ЖЕКА! А ЭТО ВИДЕО НАМ ПРИСЛАЛ...",
		"/E5/кто такой санс.",
		"/E5/Кто такой Марк Карада? Я не знаю...",
		"КУДА ПРОПАЛ СПРАЙТ?!",
		"СИЛКСОНГ ВЫШЕЛ? ЧТО!?!?",
		"/E5/\"ЛЕГАЛЬНАЯ\" ЛИ Я?? ВРОДЕ ЗАКОН НЕ НАРУШАЮ... КАКОЕ ВАМ ДЕЛО?!",
		"/E4/У меня был хомячок и его звали Хома и он умер когда слишком громко чихнул...",
		"ЭТО СПАРТАААААААА!!!!!!",
		"МЕНЯ ПОПРОСИЛИ СКИНУТЬ 3 ЦИФРЫ ОТ КАРТЫ ЗА МИЛЛИАРД МОНЕТ!! ЖДУ НЕ ДОЖДУСЬ, УЖЕ ПРОШЛО ПОЛ ГОДА!!",
		"/E3/АААА!!!",
		"/E6/Я ЛЮБЛЮ КОТЯТ!!!!"
	],
	"own_profile": [
		"КАКАЯ У ТЕБЯ КЛАССНАЯ СТРАНИЧКА!",
	        "/E5/НУКА... ТЫ СДЕЛАЛ ${postCount} ПОСТОВ!",
	        "/E5/И ПОСТАВИЛ ${likeCount} БАЛЛОВ!!",
	        "/E5/А ЕЩЁ ${dislikeCount} МИНУС БАЛЛОВ!!",
	        "/E5/И ОСТАВИЛ ${commentCount} КОММЕНТАРИЕВ!!",
	        "/E5/И ТЫ АКТИВНЕЕ ВСЕГО В ПОРТЕ \"${topCommunity}\"!!"
	    ],
	"profile": [
	        "/E5/ОГО, ЭТОТ ПОЛЬЗОВАТЕЛЬ СДЕЛАЛ ${postCount} ПОСТОВ",
	        "/E5/И ПОСТАВИЛ ${likeCount} БАЛЛОВ!!",
	        "/E5/ПРАВДА ЕЩЁ И ${dislikeCount} МИНУС БАЛЛОВ...",
	        "/E5/И ОСТАВИЛ ${commentCount} КОММЕНТАРИЕВ!!",
	        "/E5/ОНИ АКТИВНЕЕ ВСЕГО В ПОРТЕ \"${topCommunity}\"!!"
	    ],
	"port": [
	        "/E5/ОГО, НА ЭТОМ ПОРТЕ ${postCount} ПОСТОВ",
	        "/E5/И НА ПОСТАХ В СУММЕ ${likeCount} БАЛЛОВ",
	        "/E5/ПРАВДА ЕЩЁ ${dislikeCount} МИНУС БАЛЛОВ...",
	        "/E5/А, И ${commentCount} КОММЕНТАРИЕВ!"
	    ],
	"fortport": [
        	"/E6/ОО!! ЭТО ЖЕ ПОРТ ФОРТПОРТА!! ФОРТПОРТ, УРА!! СЛАВА ФОРТПОРТУ!!!",
        	"/E6/ОЙ, АХАХА, ТОЧНЕЕ..."
    	],
	"hh_feed": [
		"Привет ${username}! Эта страница - главная страница ФортПорта. На ней у тебя есть три вкладки - \"лента\", \"рекомендации\", \"подписки\", и \"друзья\".",
		"/E4/Лента - это место, куда попадают ВСЕ публикации сайта! Первыми всегда отображаются самые недавние, так что это идеальное место если тебе просто хочется смотреть что-то новое!",
		"/E4/Рекомендации - сделаны для нахождения чего-то нового! Здесь не будут показываться публикации твоих подписок.",
		"/E4/Подписки - здесь будут отображаться публикации из /b/портов/ на которые ты подписан! В будущем будет возможность сортировки публикаций из этой вкладке по новым, и популярным.",
		"Друзья - вкладка исключительно для публикаций твоих друзей на их страницах, идеальное место чтобы смотреть за тем, как у них дела!"
	],
	"hh_communities": [
		"Привет ${username}! Эта страница твоих портов!",
		"Хочешь, расскажу, что такое порты? ${choiceOne=`Давай!`} ${choiceTwo=`Не надо`}", 
		"/E4/Так вот, это страница, где ты можешь посмотреть порты на которые ты подписан, создать новый порт, или найти среди тех, которые уже созданы!",
		"Если хочешь узнать, как создать свой порт, просто нажми на кнопку \"создать порт\", и я расскажу тебе всё подробнее!"
	],
	"hh_whatis_port": [
		"Порт - это место на ФортПорте, куда ты можешь отправлять свои публикации!",
		"/E5/Вместо того, чтобы выкладывать всё на свою страницу, ты можешь разделять свои публикации на разные тематические порты. Так твои публикации будет легче найти тем, кому интересна эта тема!",
		"Порты бывают двух типов - Сообщества, и Страницы.",
		"/E5/В сообществах, публикации от имени порта может делать каждый участник этого сообщества",
		"/E5/А на страницах публикации могут делать только владелец этого порта, и модераторы, имеющие на то привелегии!"
	],
	"hh_community": [
		"Привет ${username}! Это страница порта ${pagetitle}!",
		"Хочешь, расскажу, что такое порты? ${choiceOne=`Давай!`} ${choiceTwo=`Не надо`}",
		"Здесь публикации идут не от имени людей (Ну, или не только), а от имени порта.",
		"Если это твой порт, у него будет кнопка \"редактировать\", если нажмёшь на неё, я расскажу тебе побольше!",
		"И кстати, если нажмёшь на меня, я расскажу тебе о статистике этого порта!"
	],
	"hh_community_settings": [
		"Привет ${username}! Это страница настроек твоего прекрасного порта!",
		"Здесь ты можешь редактировать его название, статус, описание, правила, а так же менять его тип!",
		"Если, по какой-то причине, тебе кажется что его надо удалить, это ты тоже можешь сделать!",
		"Во вкладке \"участники\" ты можешь назначать модераторов, или удалять их, а так же смотреть список пользователей, которые подписаны на этот порт!"
	],
	"hh_profile": [
		"Привет ${username}! Это профиль пользователя ${pagetitle}!",
		"Если хочешь, можешь добавить их в друзья, или написать им сообщение!",
		"А если нажмёшь на меня, я расскажу тебе о статистике этого пользователя!"
	],
	"hh_own_profile": [
		"Привет ${username}! Это страница твоего профиля!",
		"Если хочешь изменить своё имя, поставить себе статус, или описание, ты можешь это сделать нажав на кнопку \"редактировать\"!",
		"Ну и если нажмёшь на меня, я расскажу тебе о твоей статистике!"
	],
	"hh_settings": [
		"Привет ${username}! Это страница с настройками!",
		"Тут ты можешь настроить свой профиль, свои предпочтения приватности, а так же настроить под себя сам сайт!",
		"В первой вкладке, \"профиль\", ты можешь изменить своё имя, статус, описание, фото профиля, фон профиля, а так же очень много другой информации, которая пока-что нигде не отображается, но обязательно будет!",
		"Во второй вкладке, \"безопасность\", есть все настройки чтобы скрыться от социума! Ты можешь скрыть своих друзей, свои порты, запретить личные сообщения, или вовсе сделать свой профиль анонимным! В таком случае, на него никто не сможет зайти!",
		"Во третьей вкладке, \"кастомизация\", ты можешь изменить фон сайта, а так же потыкать на кнопки, которые пока что не имеют никакого функционала! Ахах!",
		"/E7/Т-только не нажимай на кноку \"Отключить помощника\"!!! О-она очень важна для работы сайта! Если нажмёшь, он взорвётся!!!"
	],
	"hh_new_community": [
    "Привет ${username}! Это страница для создания нового порта!",
    "Порты можно делать по разным причинам, и для этого они поделены на сообщества и страницы!",
    "Сообщества - создают преимущественно для собрания единомышленников в одном тематически окрашенном месте. Публикации там делают все.",
    "Страницы - нужны тем, кто хочет отдельное место для своего дела. Будь то анонимно ведённая страница художника, или страница какого-нибудь бренда. Тут выкладывать могут лишь владелец и модераторы.",
    "Когда ты определился с тематикой порта, выбирай ему название, пиши описание, и заполняй правила!",
    "Не переживай, всё это можно будет изменить на странице настроек порта!"
]
}

const emotionMap = {
    '/E0/': '/ui/mascot/mascot-peek.webm',
    '/E1/': '/ui/mascot/mascot-lookout.webm',
    '/E2/': '/ui/mascot/mascot-wave.webm',
    '/E3/': '/ui/mascot/mascot-killed.webm',
    '/E4/': '/ui/mascot/mascot-stand.webm',
    '/E5/': '/ui/mascot/mascot-think.webm',
    '/E6/': '/ui/mascot/mascot-blush.webm',
    '/E7/': '/ui/mascot/mascot-yell.webm'
};
let currentBubble = null;
let currentMascot = null;
let pettingCount = 0;
let pettingRecord = Number(window.sessionBootstrap?.mascot?.pettingRecord) || 0;
let pettingRecordSaveTimer = null;

window.addEventListener('fortport:bootstrap', (event) => {
    pettingRecord = Math.max(
        pettingRecord,
        Number(event.detail?.mascot?.pettingRecord) || 0
    );
});

let currentVideoPath = '';

function clampMascotPosition(mascot, left, top) {
    const rect = mascot.getBoundingClientRect();
    const width = rect.width || 160;
    const height = rect.height || 280;
    return {
        left: Math.max(0, Math.min(left, window.innerWidth - width)),
        top: Math.max(0, Math.min(top, window.innerHeight - height))
    };
}

function getStoredMascotDock() {
    const savedEdge = localStorage.getItem('mascotDockEdge');
    const savedOffset = Number(localStorage.getItem('mascotDockOffset'));
    if (['left', 'right', 'bottom'].includes(savedEdge)) {
        return {
            edge: savedEdge,
            offset: Number.isFinite(savedOffset) ? savedOffset : 1
        };
    }

    const legacySide = localStorage.getItem('mascotDockSide');
    if (legacySide === 'left' || legacySide === 'right') {
        return { edge: legacySide, offset: 1 };
    }

    try {
        const oldPosition = JSON.parse(localStorage.getItem('mascotPosition') || 'null');
        if (oldPosition && Number.isFinite(oldPosition.left)) {
            return {
                edge: oldPosition.left < window.innerWidth / 2 ? 'left' : 'right',
                offset: Number.isFinite(oldPosition.top)
                    ? oldPosition.top / Math.max(1, window.innerHeight)
                    : 1
            };
        }
    } catch {}

    return { edge: 'bottom', offset: 1 };
}

function applyMascotDock(mascot, dock, persist = true, preview = false) {
    const edge = ['left', 'right', 'bottom'].includes(dock?.edge) ? dock.edge : 'bottom';
    const offset = Math.max(0, Math.min(Number(dock?.offset) || 0, 1));

    mascot.dataset.dockEdge = edge;
    mascot.dataset.dockOffset = String(offset);
    mascot.classList.toggle('mascot-dock-left', edge === 'left');
    mascot.classList.toggle('mascot-dock-right', edge === 'right');
    mascot.classList.toggle('mascot-dock-bottom', edge === 'bottom');
    mascot.classList.toggle('mascot-facing-left', edge === 'bottom' && offset > 0.5);
    mascot.classList.toggle('mascot-facing-right', edge === 'bottom' && offset <= 0.5);
    mascot.style.right = 'auto';
    mascot.style.transform = 'none';

    const rect = mascot.getBoundingClientRect();
    const w = rect.width// || (window.innerWidth <= 830 ? 90 : 160);
    const h = rect.height //|| (window.innerWidth <= 830 ? 124 : 220);
    const dx = (h - w) / 2; // overhang of the 90deg-rotated video (side docks)

    if (edge === 'left' || edge === 'right') {

        mascot.style.left = edge === 'left'
            ? `${dx}px`
            : `${Math.round(window.innerWidth - h + dx)}px`;
        mascot.style.top = `${Math.round((window.innerHeight - w) * offset - dx)}px`;
        mascot.style.bottom = 'auto';

    } else {
        // Bottom dock: zero position = bottom pixels
        mascot.style.left = `${Math.round((window.innerWidth - w) * offset)}px`;
        mascot.style.top = 'auto';
        mascot.style.bottom = '0px';
    }

    if (persist) {
        localStorage.setItem('mascotDockEdge', edge);
        localStorage.setItem('mascotDockOffset', String(offset));
        localStorage.removeItem('mascotDockSide');
        localStorage.removeItem('mascotPosition');
    }
}

function restoreMascotPosition(mascot) {
    applyMascotDock(mascot, getStoredMascotDock(), false);
}

function schedulePettingRecordSave(record) {
    const userId = localStorage.getItem('userId');
    if (!userId || userId === 'null' || userId === 'undefined') return;
    clearTimeout(pettingRecordSaveTimer);
    pettingRecordSaveTimer = setTimeout(async () => {
        try {
            const response = await fetch('/api/users/mascot/petting-record', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record })
            });
            if (!response.ok) return;
            const data = await response.json();
            pettingRecord = Math.max(pettingRecord, Number(data.pettingRecord) || 0);
        } catch (error) {
            console.error('Failed to save mascot petting record:', error);
        }
    }, 350);
}

function attachMascotInteractions(mascot, video) {
    if (!mascot || mascot.dataset.interactionsAttached === '1') return;
    mascot.dataset.interactionsAttached = '1';
    mascot.style.touchAction = 'none';
    requestAnimationFrame(() => restoreMascotPosition(mascot));

    let pointerId = null;
    let startPointerX = 0;
    let startPointerY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let moved = false;
    let headPetting = false;
    let lastPetX = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastDirection = 0;
    let directionChanges = 0;
    let horizontalTravel = 0;
    let dockCandidate = null;

    const completePettingCycle = () => {
        pettingCount += 1;
        if (pettingCount > pettingRecord) {
            pettingRecord = pettingCount;
            schedulePettingRecordSave(pettingRecord);
        }
        mascot.classList.add('mascot-being-petted');
        setTimeout(() => mascot.classList.remove('mascot-being-petted'), 180);
    };

    mascot.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.m-speech-bubble')) return;
        const rect = mascot.getBoundingClientRect();
        const relativeY = event.clientY - rect.top;
        pointerId = event.pointerId;
        startPointerX = event.clientX;
        startPointerY = event.clientY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        moved = false;
        dragging = false;
        headPetting = relativeY <= rect.height * 0.5;
        lastPetX = event.clientX;
        lastDirection = 0;
        directionChanges = 0;
        horizontalTravel = 0;
        dockCandidate = null;
        mascot.setPointerCapture(pointerId);
    });

    mascot.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        const deltaX = event.clientX - startPointerX;
        const deltaY = event.clientY - startPointerY;
        const distance = Math.hypot(deltaX, deltaY);

        if (headPetting && Math.abs(deltaY) < 44) {
            const stepX = event.clientX - lastPetX;
            const direction = Math.abs(stepX) >= 2 ? Math.sign(stepX) : 0;
            horizontalTravel += Math.abs(stepX);
            if (direction && lastDirection && direction !== lastDirection) {
                directionChanges += 1;
            }
            if (direction) lastDirection = direction;
            lastPetX = event.clientX;

            if (directionChanges >= 1 && horizontalTravel >= 36) {
                completePettingCycle();
                directionChanges = 0;
                horizontalTravel = 0;
                lastDirection = direction;
            }
            return;
        }

        if (distance < 8 && !dragging) return;
        dragging = true;
        moved = true;
        headPetting = false;
        mascot.classList.add('mascot-dragging');

        // Incremental pointer travel (smooth, no jumps between modes)
        const stepX = event.clientX - lastPointerX;
        const stepY = event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;

        const edgeSize = window.innerWidth <= 830 ? 72 : 96;
        const x = Math.max(0, Math.min(event.clientX, window.innerWidth));
        const y = Math.max(0, Math.min(event.clientY, window.innerHeight));

        if (x <= edgeSize) {
            dockCandidate = { edge: 'left', offset: y / Math.max(1, window.innerHeight) };
            applyMascotDock(mascot, dockCandidate, false, true);
        } else if (x >= window.innerWidth - edgeSize) {
            dockCandidate = { edge: 'right', offset: y / Math.max(1, window.innerHeight) };
            applyMascotDock(mascot, dockCandidate, false, true);
        } else {
            // Middle of the screen: free 2D movement, upright
            dockCandidate = null;
            const r = mascot.getBoundingClientRect();
            const w = r.width// || (window.innerWidth <= 830 ? 90 : 160);
            const h = r.height// || (window.innerWidth <= 830 ? 124 : 220);
            const nLeft = Math.max(0, Math.min(r.left + stepX, window.innerWidth - w));
            const nTop = Math.max(0, Math.min(r.top + stepY, window.innerHeight - h));
            mascot.style.left = `${nLeft}px`;
            mascot.style.top = `${nTop}px`;
            mascot.style.right = 'auto';
            mascot.style.bottom = 'auto';
            mascot.style.transform = 'none';
            mascot.classList.remove(
                'mascot-dock-left',
                'mascot-dock-right',
                'mascot-dock-bottom',
                'mascot-facing-left',
                'mascot-facing-right'
            );
        }
    });

    const finishPointer = (event) => {
        if (event.pointerId !== pointerId) return;
        if (mascot.hasPointerCapture(pointerId)) mascot.releasePointerCapture(pointerId);
        mascot.classList.remove('mascot-dragging');
        if (dragging) {
            if (dockCandidate) {
                // Dropped while clinging to a wall: keep that wall position
                applyMascotDock(mascot, dockCandidate);
            } else {
                const r = mascot.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const edgeSize = window.innerWidth <= 830 ? 72 : 96;
                if (r.left <= edgeSize) {
                    applyMascotDock(mascot, { edge: 'left', offset: 1 });
                } else if (r.right >= window.innerWidth - edgeSize) {
                    applyMascotDock(mascot, { edge: 'right', offset: 1 });
                } else {
                    applyMascotDock(mascot, {
                        edge: 'bottom',
                        offset: Math.max(0, Math.min(1, cx / Math.max(1, window.innerWidth)))
                    });
                }
            }
        }
        if (moved) {
            mascot.dataset.suppressClick = '1';
            setTimeout(() => delete mascot.dataset.suppressClick, 80);
        }
        pointerId = null;
        dragging = false;
        headPetting = false;
        dockCandidate = null;
    };

    mascot.addEventListener('pointerup', finishPointer);
    mascot.addEventListener('pointercancel', finishPointer);
    mascot.addEventListener('click', (event) => {
        if (mascot.dataset.suppressClick === '1') {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    window.addEventListener('resize', () => {
        const currentDock = {
            edge: mascot.dataset.dockEdge,
            offset: Number(mascot.dataset.dockOffset)
        };
        applyMascotDock(mascot, currentDock.edge ? currentDock : getStoredMascotDock(), false);
    });
}
let preloadVideo = null;

async function updateVideo(emotionCode, loop = true) {
    const video = document.querySelector('.mascot-video');
    if (!video) return;
    
    // Support both emotion keys (e.g. '/E4/') and direct path fallback
    const rawSrc = emotionMap[emotionCode] || emotionCode;
    if (!rawSrc) return;
    
    if (rawSrc === currentVideoPath) return;

    const cachedSrc = await getCachedVideoUrl(rawSrc);
    
    const preload = document.createElement('video');
    preload.src = cachedSrc;
    preload.preload = 'auto';
    preload.muted = true;
    preload.style.width = '160px';
    preload.style.height = '220px';
    preload.style.objectFit = 'cover';
    preload.style.position = 'fixed';
    preload.style.opacity = '0';
    preload.style.pointerEvents = 'none';

    preload.onloadeddata = function() {
        currentVideoPath = rawSrc;
        video.src = cachedSrc;
        video.loop = loop;
        video.play();
        preload.remove();
    };

    preload.onerror = function() {
        currentVideoPath = rawSrc;
        video.src = cachedSrc;
        video.loop = loop;
        video.play();
        preload.remove();
    }; 

    document.body.appendChild(preload);
}

async function detectPage() {
    const path = window.location.pathname;
    const userId = localStorage.getItem('userId');
    const isLoggedIn = userId && userId !== 'null' && userId !== 'undefined';
    
    // Fetch total users and ports
    try {
        const feedResponse = await fetch(`/api/mascot/data/feed`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const feedData = await feedResponse.json();
        window.totalUsers = feedData.totalUsers || 0;
        window.totalCommunities = feedData.totalCommunities || 0;
    } catch (e) {
        window.totalUsers = '?';
        window.totalCommunities = '?';
    }
    
    if (!isLoggedIn) {
        currentPage = 'guest';
        pageData = null;
        return;
    }
    
    const username = localStorage.getItem('username') || 'друг';
    const handHolding = localStorage.getItem('handHolding') === '1';
    
    // Reset HH arrays
    hhPhrases = [];
    hhSecondary = [];
    
    // --- DETECT PAGE AND FILL HH ---
    
    // MAIN FEED
    if (path === '/' || path === '/main' || path.includes('/main.html')) {
        currentPage = 'feed';
        if (handHolding && !localStorage.getItem('hh_feed_done')) {
            hhPhrases = [...phrases.hh_feed];
        }
        return;
    }
    
    // COMMUNITIES PAGE
    if (path.includes('/communities')) {
        currentPage = 'communities';
        if (handHolding && !localStorage.getItem('hh_communities_done')) {
            hhPhrases = [...phrases.hh_communities];
        }
        return;
    }

if (path.includes('/new_community') || path.includes('/mobile/new_community')) {
    currentPage = 'new_community';
    if (handHolding && !localStorage.getItem('hh_new_community_done') !== '1') {
        hhPhrases = [...phrases.hh_new_community];
    }
    return;
}
    
    // COMMUNITY SETTINGS
    if (path.includes('/community/settings')) {
        currentPage = 'community_settings';
        if (handHolding && !localStorage.getItem('hh_community_settings_done')) {
            const title = document.title.replace(' - ФортПорт', '') || 'порт';
            hhPhrases = phrases.hh_community_settings.map(p => 
                p.replace(/\${pagetitle}/g, title)
            );
        }
    }
    
    // SINGLE COMMUNITY
    if (path.includes('/community')) {
        currentPage = 'community';
        const urlParams = new URLSearchParams(window.location.search);
        const communityId = urlParams.get('id');
        
        if (communityId) {
            try {
                const response = await fetch(`/api/mascot/data/community/${communityId}`, {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                pageData = await response.json();
            } catch (e) {
                pageData = null;
            }
        }
        
        if (handHolding && !localStorage.getItem('hh_community_done')) {
            const title = document.title.replace(' - ФортПорт', '') || 'порт';
            hhPhrases = phrases.hh_community.map(p => 
                p.replace(/\${pagetitle}/g, title)
            );
        }
        return;
    }
    
    // PROFILE (own or other)
    if (path.includes('/profile')) {
        const urlParams = new URLSearchParams(window.location.search);
        const profileUserId = urlParams.get('id') || userId;
        
        try {
            const response = await fetch(`/api/mascot/data/user/${profileUserId}`, {
                method: 'GET',
                credentials: 'same-origin'
            });
            pageData = await response.json();
        } catch (e) {
            pageData = null;
        }
        
        if (profileUserId == userId) {
            currentPage = 'own_profile';
            if (handHolding && !localStorage.getItem('hh_own_profile_done')) {
                const title = document.title.replace(' - ФортПорт', '') || 'твой профиль';
                hhPhrases = phrases.hh_own_profile.map(p => 
                    p.replace(/\${pagetitle}/g, title)
                );
            }
        } else {
            currentPage = 'profile';
            if (handHolding && !localStorage.getItem('hh_profile_done')) {
                const title = document.title.replace(' - ФортПорт', '') || 'пользователь';
                hhPhrases = phrases.hh_profile.map(p => 
                    p.replace(/\${pagetitle}/g, title)
                );
            }
        }
        return;
    }
    
    // SETTINGS
    if (path.includes('/settings')) {
        currentPage = 'settings';
        if (handHolding && !localStorage.getItem('hh_settings_done')) {
            hhPhrases = [...phrases.hh_settings];
        }
        return;
    }
    
    // FRIENDS
    if (path.includes('/friends')) {
        currentPage = 'friends';
        // No HH for friends yet
        return;
    }
    
    currentPage = 'feed';
}

let newsPhrases = [];

async function getNews() {
    try {
        const response = await fetch(`/api/users/mascot/news`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const data = await response.json();
        
        if (data.news && data.news.length > 0) {
            const allLines = [];
            data.news.forEach(newsItem => {
                const lines = newsItem.content.split('\n').filter(line => line.trim() !== '');
                allLines.push(...lines);
            });
            
            if (allLines.length > 0) {
                newsPhrases = allLines;
                return true;
            }
        }
        
        newsPhrases = [];
        return false;
    } catch (err) {
        console.error('Error fetching news:', err);
        newsPhrases = [];
        return false;
    }
}

function closeBubble() {
    updateVideo('/E4/');
    
    if (currentBubble) {
        currentBubble.remove();
        currentBubble = null;
    }
}

async function resolveMascotPreferences(isLoggedIn) {
    if (!isLoggedIn) {
        bricked = localStorage.getItem('mascotBricked');
        handHolding = localStorage.getItem('handHolding');
        return;
    }

    try {
        const bootstrapMascot = window.sessionBootstrap?.mascot;
        if (bootstrapMascot) {
            bricked = bootstrapMascot.bricked === -1 ? '-1' : '0';
            handHolding = bootstrapMascot.handHolding ? '1' : '0';
        } else {
            const response = await fetch('/api/users/mascot/status', {
                credentials: 'same-origin'
            });
            if (!response.ok) throw new Error(`Mascot status request failed: ${response.status}`);
            const status = await response.json();
            bricked = Number(status.bricked) === -1 ? '-1' : '0';
            handHolding = String(status.hand_holding);
        }

        localStorage.setItem('mascotBricked', bricked);
        localStorage.setItem('handHolding', handHolding);
        sessionStorage.setItem('mascotBricked', bricked);
    } catch (error) {
        console.error('Mascot status sync error:', error);
        bricked = localStorage.getItem('mascotBricked');
        handHolding = localStorage.getItem('handHolding');
    }
}

async function initMascot() {
    try {
        const userId = localStorage.getItem('userId');
        const isLoggedIn = userId && userId !== 'null' && userId !== 'undefined';
        await resolveMascotPreferences(isLoggedIn);
        
        // --- GUEST USERS ---
        if (!isLoggedIn) {
            guestStep = 0;
            
            const mascot = document.createElement('div');
            mascot.classList.add('mascot-dummy');
            currentMascot = mascot;
            
            const video = document.createElement('video');
            video.classList.add('mascot-video');
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            mascot.appendChild(video);
                
            const speechBubble = document.createElement('div');
            speechBubble.classList.add('m-speech-bubble');
            currentBubble = speechBubble;
            
            const phrase = `ПРИВЕТ!!! Меня зовут Жека, а ты - на самой крутой социальной сети в рунете! На ФортПорте! Здесь ты можешь создавать сообщества, и общаться с друзьями!`;
    
            speechBubble.innerHTML = `
                <button onclick="closeBubble()" class="m-bubble-close">⨉</button>
                <div class="m-speech-text">${phrase}</div>
                <div class="m-speech-buttons-row">
                    <button class="m-speech-button" onclick="newPhrase()">Дальше</button>
                </div>
            `;
    
            // MUST append mascot to document BEFORE calling updateVideo!
            document.body.appendChild(mascot);
            mascot.appendChild(speechBubble);
            attachMascotInteractions(mascot, video);
            await updateVideo('/E2/');
            return;
        }
        
        const username = localStorage.getItem('username') || 'друг';
        
        // Create mascot container
        const mascot = document.createElement('div');
        mascot.classList.add('mascot-dummy');
        currentMascot = mascot;
        
        // Create video element
        const video = document.createElement('video');
        video.classList.add('mascot-video');
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        mascot.appendChild(video);
        
        let speechBubble = null;

        // --- FIRST: BRICKED / FIRST VISIT ---
        if (bricked == -1) {
            const phrase = `ХЕЙ ${username}! МЕНЯ ЗОВУТ ЖЕКА! Я БУДУ ЗДЕСЬ КАЖДЫЙ РАЗ КОГДА САЙТ ОБНОВЛЯЕТСЯ! ТЫ МОЖЕШЬ КИНУТЬ В МЕНЯ КИРПИЧ ЧТОБЫ УБРАТЬ, ЕСЛИ Я БУДУ ТЕБЕ МЕШАТЬ!`;
            
            speechBubble = document.createElement('div');
            speechBubble.classList.add('m-speech-bubble');
            currentBubble = speechBubble;
            speechBubble.innerHTML = `
                <button onclick="closeBubble()" class="m-bubble-close">⨉</button>
                <div class="m-speech-text">${phrase}</div>
                <div class="m-speech-buttons-row">
                    <button class="m-speech-button" onclick="throwBrick()">Кинуть кирпич</button>
                    <button class="m-speech-button" onclick="mascotAccept()">Не надо!</button>
                </div>
            `;
            
            await fetch(`/api/users/mascot/status`, { 
                method: 'POST', 
                credentials: 'same-origin' 
            });
            
            document.body.appendChild(mascot);
            mascot.appendChild(speechBubble);
            attachMascotInteractions(mascot, video);
            await updateVideo('/E2/');
            return;
        }
        
        // --- SECOND: CHECK NEWS ---
        const hasNews = await getNews();
        if (hasNews && newsPhrases.length > 0) {
            window.newsPhrasesOriginalLength = newsPhrases.length;
            
            document.body.appendChild(mascot);
            attachMascotInteractions(mascot, video);
            await updateVideo('/E1/');
            
            mascot.addEventListener('click', function newsClickHandler(e) {
                if (e.target.closest('.m-speech-bubble')) return;
                
                if (!currentBubble) {
                    const speechBubble = document.createElement('div');
                    speechBubble.classList.add('m-speech-bubble');
                    currentBubble = speechBubble;
                    speechBubble.innerHTML = `
                        <button onclick="closeBubble()" class="m-bubble-close">⨉</button>
                        <div class="m-speech-text"></div>
                        <div class="m-speech-buttons-row">
                            <button class="m-speech-button" onclick="newPhrase()">Дальше</button>
                        </div>
                    `;
                    mascot.appendChild(speechBubble);
                }
                
                newPhrase();
                mascot.removeEventListener('click', newsClickHandler);
                
                mascot.addEventListener('click', (e) => {
                    if (e.target.closest('.m-speech-bubble')) return;
                    if (currentBubble) {
                        newPhrase();
                    } else {
                        openBubble();
                    }
                });
            });
            return;
        }
        
        // --- THIRD: CHECK HANDHOLDING ---
        if (hhPhrases.length > 0) {
            document.body.appendChild(mascot);
            attachMascotInteractions(mascot, video);
            await updateVideo('/E1/');
            
            mascot.addEventListener('click', function hhClickHandler(e) {
                if (e.target.closest('.m-speech-bubble')) return;
                
                if (!currentBubble) {
                    const speechBubble = document.createElement('div');
                    speechBubble.classList.add('m-speech-bubble');
                    currentBubble = speechBubble;
                    speechBubble.innerHTML = `
                        <button onclick="closeBubble()" class="m-bubble-close">⨉</button>
                        <div class="m-speech-text"></div>
                        <div class="m-speech-buttons-row">
                            <button class="m-speech-button" onclick="newPhrase()">Дальше</button>
                        </div>
                    `;
                    mascot.appendChild(speechBubble);
                }
                
                newPhrase();
                mascot.removeEventListener('click', hhClickHandler);
                
                mascot.addEventListener('click', (e) => {
                    if (e.target.closest('.m-speech-bubble')) return;
                    if (currentBubble) {
                        newPhrase();
                    } else {
                        openBubble();
                    }
                });
            });
            return;
        }
        
        // --- FOURTH: NORMAL (bricked === 0) ---
        document.body.appendChild(mascot);
        attachMascotInteractions(mascot, video);
        await updateVideo('/E0/');
        
        mascot.addEventListener('click', (e) => {
            if (e.target.closest('.m-speech-bubble')) return;
            if (currentBubble) {
                newPhrase();
            } else {
                openBubble();
            }
        });
        
    } catch (err) {
        console.error('Mascot init error:', err);
    }
}

function newPhrase() {
    const username = localStorage.getItem('username') || 'друг';
    const userId = localStorage.getItem('userId');
    const isLoggedIn = userId && userId !== 'null' && userId !== 'undefined';

    // GUEST FLOW
    if (!isLoggedIn && currentPage === 'guest') {
        if (guestStep === 0) {
            guestStep = 1;
            const phrase = `А так же делать себе красивый профиль! Но.. Ой! У тебя его ещё нет! Для этого надо сначала зарегистрироваться!`;
            const textElement = document.querySelector('.m-speech-text');
            if (textElement) {
                textElement.textContent = phrase;
            }
            const buttonsRow = document.querySelector('.m-speech-buttons-row');
            if (buttonsRow) {
                buttonsRow.innerHTML = `
                    <a href="/register" class="m-speech-button">Зарегистрироваться</a>
                    <button class="m-speech-button" onclick="throwBrick()">Кинуть кирпич</button>
                `;
            }
            return;
        } else {
            closeBubble();
            return;
        }
    }

if (hhSecondary.length > 0) {
        const rawPhrase = hhSecondary.shift();
    let phrase = rawPhrase.replace(/\${username}/g, username);
        let emotionCode = "/E2/";
        
        const emotionMatch = phrase.match(/\/E([0-9])\//);
        if (emotionMatch) {
            emotionCode = emotionMatch[0];
            phrase = phrase.replace(/\/E[0-9]\//, '');
        }
        
        const textElement = document.querySelector('.m-speech-text');
        if (textElement) {
            textElement.textContent = phrase;
        }
        
        updateVideo(emotionCode);
        
        if (hhSecondary.length === 0) {
            const buttonsRow = document.querySelector('.m-speech-buttons-row');
            if (buttonsRow) {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="event.stopPropagation(); newPhrase()">Дальше</button>
                `;
            }
        }
        return;
    }
    
    // --- HH MAIN ---
    if (hhPhrases.length > 0) {
    const rawPhrase = hhPhrases.shift();
    let phrase = rawPhrase;
    let emotionCode = "/E2/";
    let hasChoice = false;
    let choiceOneText = '';
    let choiceTwoText = '';
    
    // REPLACE USERNAME
    phrase = phrase.replace(/\${username}/g, username);
    
    // Check for choices
    const choiceMatch = phrase.match(/\${choiceOne=`([^`]*)`}\s*\${choiceTwo=`([^`]*)`}/);
    if (choiceMatch) {
        hasChoice = true;
        choiceOneText = choiceMatch[1];
        choiceTwoText = choiceMatch[2];
        phrase = phrase.replace(/\${choiceOne=`[^`]*`}\s*\${choiceTwo=`[^`]*`}/, '');
    }
    
    const emotionMatch = phrase.match(/\/E([0-9])\//);
    if (emotionMatch) {
        emotionCode = emotionMatch[0];
        phrase = phrase.replace(/\/E[0-9]\//, '');
    }
        
        const textElement = document.querySelector('.m-speech-text');
        if (textElement) {
            textElement.textContent = phrase;
        }
        
        updateVideo(emotionCode);
        
        // Update buttons
        const buttonsRow = document.querySelector('.m-speech-buttons-row');
        if (buttonsRow) {
            if (hasChoice) {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="event.stopPropagation(); loadWhatis('ports')">${choiceOneText}</button>
                    <button class="m-speech-button" onclick="event.stopPropagation(); newPhrase()">${choiceTwoText}</button>
                `;
            } else if (hhPhrases.length === 0) {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="completeHH()">Я всё понял!</button>
                `;
            } else {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="event.stopPropagation(); newPhrase()">Дальше</button>
                `;
            }
        }
        return;
    }

    // NEWS FLOW - Highest priority
    if (newsPhrases.length > 0) {
        // Mark as read immediately when first news phrase is shown
        if (newsPhrases.length === window.newsPhrasesOriginalLength) {
            markAllNewsAsRead();
        }
        
        const rawPhrase = newsPhrases.shift();
        let phrase = rawPhrase;
        let emotionCode = "/E2/";
        
        const emotionMatch = phrase.match(/\/E([0-9])\//);
        if (emotionMatch) {
            emotionCode = emotionMatch[0];
            phrase = phrase.replace(/\/E[0-9]\//, '');
        }
        
        const textElement = document.querySelector('.m-speech-text');
        if (textElement) {
            textElement.textContent = phrase;
        }
        
        updateVideo(emotionCode);
        
        // Update buttons if this is the last news phrase
        if (newsPhrases.length === 0) {
            const buttonsRow = document.querySelector('.m-speech-buttons-row');
            if (buttonsRow) {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="closeBubble()">Прочитано!</button>
                `;
            }
        }
        
        return;
    }

    // REGULAR FLOW
    let phrase = '';
    let useRandom = false;
    let emotionCode = "/E2/";
    
    if (firstClick) {
        const greetingPool = [...phrases.greetings];
        const randomIndex = Math.floor(Math.random() * greetingPool.length);
        phrase = greetingPool[randomIndex].replace(/\${username}/g, username);
        firstClick = false;
    } else if (currentPage === 'profile' && pageData && profileIndex < phrases.profile.length) {
        phrase = phrases.profile[profileIndex]
            .replace(/\${username}/g, username)
            .replace(/\${postCount}/g, pageData.postCount)
            .replace(/\${likeCount}/g, pageData.likeCount)
            .replace(/\${dislikeCount}/g, pageData.dislikeCount)
            .replace(/\${commentCount}/g, pageData.commentCount)
            .replace(/\${topCommunity}/g, pageData.topCommunity);
        profileIndex++;
    } else if (currentPage === 'own_profile' && pageData && profileIndex < phrases.own_profile.length) {
        phrase = phrases.own_profile[profileIndex]
            .replace(/\${username}/g, username)
            .replace(/\${postCount}/g, pageData.postCount)
            .replace(/\${likeCount}/g, pageData.likeCount)
            .replace(/\${dislikeCount}/g, pageData.dislikeCount)
            .replace(/\${commentCount}/g, pageData.commentCount)
            .replace(/\${topCommunity}/g, pageData.topCommunity);
        profileIndex++;
    } else if (currentPage === 'community' && pageData) {
        const urlParams = new URLSearchParams(window.location.search);
        const communityId = urlParams.get('id');
        
        if (communityId === '1773926513828' && !window.fortportGreeted) {
            if (!window.fortportStep) {
                window.fortportStep = 0;
            }
            
            if (window.fortportStep === 0) {
                phrase = phrases.fortport[0];
                window.fortportStep = 1;
            } else if (window.fortportStep === 1) {
                phrase = phrases.fortport[1];
                window.fortportStep = 2;
                window.fortportGreeted = true;
            } else if (communityIndex < phrases.port.length) {
                phrase = phrases.port[communityIndex]
                    .replace(/\${username}/g, username)
                    .replace(/\${postCount}/g, pageData.postCount)
                    .replace(/\${likeCount}/g, pageData.likeCount)
                    .replace(/\${dislikeCount}/g, pageData.dislikeCount)
                    .replace(/\${commentCount}/g, pageData.commentCount);
                communityIndex++;
            } else {
                useRandom = true;
            }
        } else if (communityIndex < phrases.port.length) {
            phrase = phrases.port[communityIndex]
                .replace(/\${username}/g, username)
                .replace(/\${postCount}/g, pageData.postCount)
                .replace(/\${likeCount}/g, pageData.likeCount)
                .replace(/\${dislikeCount}/g, pageData.dislikeCount)
                .replace(/\${commentCount}/g, pageData.commentCount);
            communityIndex++;
        } else {
            useRandom = true;
        }
    } else {
        useRandom = true;
    }
    
    if (useRandom || !phrase) {
        const randomPool = [...phrases.random];
        const randomIndex = Math.floor(Math.random() * randomPool.length);
        phrase = randomPool[randomIndex]
            .replace(/\${username}/g, username)
            .replace(/\${totalusers}/g, window.totalUsers || '?')
            .replace(/\${totalports}/g, window.totalCommunities || '?');
    }
    
    const emotionMatch = phrase.match(/\/E([0-9])\//);
    if (emotionMatch) {
        emotionCode = emotionMatch[0];
        phrase = phrase.replace(/\/E[0-9]\//, '');
    }
    
    const textElement = document.querySelector('.m-speech-text');
    if (textElement) {
        textElement.textContent = phrase;
    }
    
    updateVideo(emotionCode);
}

function loadWhatis(type) {
    if (type === 'ports') {
        hhSecondary = [...phrases.hh_whatis_port];
        // Close and reopen bubble to show new content
        if (currentBubble) {
            // Update buttons
            const buttonsRow = document.querySelector('.m-speech-buttons-row');
            if (buttonsRow) {
                buttonsRow.innerHTML = `
                    <button class="m-speech-button" onclick="newPhrase()">Дальше</button>
                `;
            }
        }
        newPhrase(); // Show first whatis phrase
    }
}

function completeHH() {
    const stepMap = {
        'feed': 'hh_feed_done',
        'communities': 'hh_communities_done',
        'community': 'hh_community_done',
        'community_settings': 'hh_community_settings_done',
        'new_community': 'hh_new_community_done',
        'profile': 'hh_profile_done',
        'own_profile': 'hh_own_profile_done',
        'settings': 'hh_settings_done'
    };
    
    const key = stepMap[currentPage];
    if (key) {
        localStorage.setItem(key, '1');
    }
    
    closeBubble();
    hhPhrases = [];
    hhSecondary = [];
    
    // Change to stand
    updateVideo('/E4/');
}

async function markAllNewsAsRead() {
    try {
        const response = await fetch(`/api/users/mascot/news`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const data = await response.json();
        
        if (data.news && data.news.length > 0) {
            for (const item of data.news) {
                await fetch(`/api/users/mascot/news`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newsId: item.id }),
                    credentials: 'same-origin'
                });
            }
        }
    } catch (err) {
        console.error('Error marking news as read:', err);
    }
}

function openBubble() {
    if (currentBubble) {
        currentBubble.remove();
        currentBubble = null;
    }
    
    const mascot = document.querySelector('.mascot-dummy');
    if (!mascot) return;
    
    // Change video to wave
    updateVideo('/E2/');
    
    // Create empty bubble
    const speechBubble = document.createElement('div');
    speechBubble.classList.add('m-speech-bubble');
    currentBubble = speechBubble;
    
    speechBubble.innerHTML = `
        <button onclick="closeBubble()" class="m-bubble-close">⨉</button>
        <div class="m-speech-text"></div>
    `;
    
    mascot.appendChild(speechBubble);
    
    // Now fill it with a phrase
    newPhrase();
}

function throwBrick() {
    // Change video to killed animation (non-looping)
    updateVideo('/E3/', false);
    
    fetch(`/api/users/mascot/status`, { 
        method: 'POST', 
        credentials: 'same-origin' 
    }).then(() => {
        setTimeout(() => {
            closeBubble();
            if (currentMascot) {
                currentMascot.remove();
                currentMascot = null;
            }
        }, 800);
    });
}

function mascotAccept() {
	localStorage.setItem('mascotBricked', '0')
	sessionStorage.setItem('mascotBricked', '0')
    bricked = '0'
    fetch('/api/users/mascot/status', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bricked: 0 })
    }).catch(error => console.error('Mascot accept sync error:', error))
	closeBubble();
}

document.addEventListener('DOMContentLoaded', async () => {
    precacheAllMascotVideos();
    await detectPage();
    await initMascot();
});

window.throwBrick = throwBrick;
window.mascotAccept = mascotAccept;
window.closeBubble = closeBubble;
window.newPhrase = newPhrase;
window.openBubble = openBubble;
window.hhPhrases = hhPhrases;
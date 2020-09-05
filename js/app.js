if (location.search.includes("__debug__"))
    window.onerror = (...arg) => document.querySelector("footer").textContent = arg;

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    onOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
});

const hide = elem => elem.classList.add("is-hidden");
const show = elem => elem.classList.remove("is-hidden");

let courseData = {};
let selectedCourse = {};
let department = {}

let filter = {
    department: false,
    departmentRegex: -1,
};

let config = {};

firebase.initializeApp(firebaseConfig);
firebase.analytics?.();

const db = firebase.database();

const loginInfo = Object.fromEntries(new URLSearchParams(location.search));
if (loginInfo.token) {
    document.getElementById("user-status").textContent = "...";
    document.getElementById("user-status").onclick = undefined;

    window.history.replaceState({}, '', APP_URL);
    firebase.auth().signInWithCustomToken(loginInfo.token).then(user => {
        if (user.additionalUserInfo.isNewUser) {
            firebase.auth().currentUser.updateEmail(loginInfo.email);
            save();
        }
    });
}


db.ref("news/").orderByKey().limitToLast(1).on("value", function (snapshot) {
    const lastReadNews = +localStorage.getItem("lastReadNews");
    const value = snapshot.val();
    const [id, news] = Object.entries(value)[0];
    if (id > lastReadNews)
        Swal.fire({ title: news.title, html: news.content.replace(/\\t/g, "\t"), icon: 'info' })

    localStorage.setItem("lastReadNews", id);
});

firebase.auth().onAuthStateChanged(function (user) {
    document.getElementById("user-status").textContent = user ? `嗨，${user.displayName}` : "Login";
    document.getElementById("user-status").onclick = user ? undefined : login;

    if (user && !share) {
        db.ref(`user/${firebase.auth().currentUser.uid}/userInfo`).set({
            displayName: user.displayName,
            email: user.email
        });
        db.ref(`user/${firebase.auth().currentUser.uid}/${YEAR}${SEMESTER}`)
            .once("value", function (snapshot) {
                if (!snapshot.val()) return;
                const { course = {}, lastUpdate: remoteLastUpdate } = snapshot.val();
                const isSame = Object.keys(selectedCourse).length === Object.keys(course).length &&
                    Object.keys(course).sort().every((value, index) => value === Object.keys(selectedCourse).sort()[index])
                const localLastUpdate = +localStorage.getItem("lastUpdate");

                if (!isSame) {
                    if (new Date(localLastUpdate) < new Date(remoteLastUpdate)) {
                        // sync: remote to local
                        Toast.fire({ text: "已從伺服器更新你的課表" });
                        selectedCourse = course;
                        save(false);
                    } else {
                        // sync: local to remote
                        save();
                    }
                }
                renderAllSelected();
            })
    }
});

const login = () => {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    firebase.auth().signInWithRedirect(provider);    
    //location.replace(`https://accounts.google.com/o/oauth2/auth?client_id=${OAUTH_CLIENT_ID}&response_type=code&scope=email&redirect_uri=${APP_URL}`);
}

// Safari sucks.

const supportBigInt = typeof BigInt !== 'undefined';
if (!supportBigInt) BigInt = JSBI.BigInt;

function parseBigInt(value, radix = 36) {
    const add = (a, b) => supportBigInt ? a + b : JSBI.add(a, b);
    const mul = (a, b) => supportBigInt ? a * b : JSBI.multiply(a, b);
    return [...value.toString()]
        .reduce((r, v) => add(
            mul(r, BigInt(radix)),
            BigInt(parseInt(v, radix))
        ), BigInt(0));
}

function loadFromShareLink() {
    const shareKey = new URLSearchParams(location.search).get("share");
    const rawCourseUnits = shareKey.split(",");
    const courseUnits = rawCourseUnits.reduce((a, b) => {
        const times = parseInt((b.match(/\d+/) || [1])[0]);
        const unit = b.match(/[A-Z]+/);
        a.push((unit === null ? b : Array(times).fill(unit[0])));
        return a;
    }, []).flat();
    const courseNumbers = parseBigInt(courseUnits[courseUnits.length - 1]).toString().match(/.{6}/g);
    return courseNumbers.reduce((a, b, c) => (a[`${YS}${courseUnits[c]}${b}`] = true, a), {});
}

function loadFromLocalStorage() {
    return JSON.parse(localStorage.getItem("selectedCourse")) || {};
}

const totalCredits = () => Object.keys(selectedCourse).reduce((accu, id) => +courseData[id].credit + accu, 0);

let share = false;
if (location.search.includes("share=")) {
    share = true;
    hide(document.querySelector(".sidebar"));
    show(document.querySelector("#import"));
}

// Render timetable.
ORDERS.forEach(period => {
    const row = document.createElement("tr");
    const time = document.createElement('th');
    time.textContent = `${period}`;
    const isExtra = (period.match(/[a-cn]/) !== null);
    if (isExtra)
        time.classList.add('extra');
    row.appendChild(time);
    document.querySelector(".timetable tbody").appendChild(row);
    DAYS.forEach(day => {
        const block = document.createElement('td');
        block.id = `${day}${period}`;
        if (day === "S")
            block.classList.add('weekend');
        if (isExtra)
            block.classList.add('extra');
        row.appendChild(block);
    });
});

const settingOptions = [
    {
        key: "trimTimetable",
        description: "我中午、晚上不用上課",
        callback: value => value ?
            document.querySelectorAll(".extra").forEach(hide) :
            document.querySelectorAll(".extra").forEach(elem =>
                (!elem.classList.contains("weekend") || !config.hideWeekend) && show(elem)
            )
    }, {
        key: "hideWeekend",
        description: "我週末沒課",
        callback: value => value ?
            document.querySelectorAll(".weekend").forEach(hide) :
            document.querySelectorAll(".weekend").forEach(elem =>
                (!elem.classList.contains("extra") || !config.trimTimetable) && show(elem)
            )
    }, {
        key: "hideTag",
        description: "隱藏課程列表中的 tag",
        callback: value => {
            const cssSheet = document.getElementById("custom-style").sheet;
            value ?
                cssSheet.insertRule(".course .tag{display: none;}", 0) :
                cssSheet.cssRules.length && cssSheet.deleteRule(0)
        }
    }
];

renderConfig(settingOptions);

// Fetch course data.
Promise.all([
    `course-data/${YEAR}${SEMESTER}-data.json`,
    `course-data/department.json`
].map(url => fetch(url).then(r => r.json())))
    .then(response => {
        const [data, department] = response;

        courseData = data;
        selectedCourse = share ? loadFromShareLink() : loadFromLocalStorage();

        document.querySelector(".input").disabled = false;
        document.querySelector(".input").placeholder = "課號 / 課名 / 老師";
        document.querySelector(".credits").textContent = `${totalCredits()} 學分`;
        renderAllSelected();
        renderDepartment(department);
    });

function setFilter(filterData) {
    Object.entries(filterData)
        .forEach(([key, value]) => {
            if (key in filter)
                filter[key] = value;
            else
                throw `${key} not in filter!`;
        });
    renderSearchResult();
}


function renderConfig(options) {
    const storedConfig = JSON.parse(localStorage.getItem("timetableConfig")) || {};
    options.forEach(rule => {
        const label = document.createElement("label");
        label.className = "checkbox";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.onclick = ({ target }) => {
            config[rule.key] = target.checked;
            localStorage.setItem("timetableConfig", JSON.stringify(config));
            rule.callback(target.checked);
        };
        checkbox.checked = !!storedConfig[rule.key];
        label.appendChild(checkbox);
        label.append(" " + rule.description);
        document.querySelector("#setting .dropdown-item").appendChild(label);

        config[rule.key] = checkbox.checked;
        rule.callback(checkbox.checked);
    });

    config = storedConfig;
}

function renderDepartment(department) {
    const renderSelect = (id, options) => {
        if (id == 3) options = GRADE;
        document.querySelector(`.department[data-level="${id}"]`).parentElement.classList.remove('is-hidden')
        document.querySelector(`.department[data-level="${id}"]`).innerHTML =
            (id === 1 ? "<option selected>全部開課單位</option>" : "<option disabled selected>選擇開課單位</option>") +
            Object.entries(options).map(
                ([name]) => `<option>${name}</option>`
            ).join('');
    }
    renderSelect(1, department);
    document.querySelectorAll('select').forEach((elem, _, selects) =>
        elem.onchange = ({ target }) => {
            const level = +target.dataset.level;
            let currentValue;
            if (level === 1) {
                if (elem.value === "全部開課單位") {
                    setFilter({ department: false, departmentRegex: -1 });
                    hide(selects[1].parentElement);
                    hide(selects[2].parentElement);
                    return;
                }
                currentValue = department[elem.value];
            }
            else if (level === 2)
                currentValue = department[selects[0].value][elem.value];
            else
                currentValue = department[selects[0].value][selects[1].value] + GRADE[elem.value];
            
            const hasNextLevel = !!(level <= 2);
            if (hasNextLevel)
                renderSelect(level + 1, currentValue)
            else
                setFilter({ department: true, departmentRegex: (new RegExp(currentValue)) });

            selects.forEach(select =>
                (+select.dataset.level > level + hasNextLevel) &&
                hide(select.parentElement)
            );
        }
    )
}

function renderAllSelected() {
    document.querySelector(".credits").textContent = `${totalCredits()} 學分`;
    document.querySelectorAll(".timetable .period").forEach(elem => elem.remove())
    document.querySelector(".selected").innerHTML = '';
    for (courseId in selectedCourse) {
        const course = courseData[courseId];
        renderPeriodBlock(course);
        appendCourseElement(course);
    }
}

function getCourseIdFromElement(element) {
    return element.closest('.course,.period').dataset.id;
}

document.addEventListener("click", function ({ target }) {
    if (target.classList.contains('toggle-course'))
        toggleCourse(getCourseIdFromElement(target));

    if (target.classList.contains('modal-launcher'))
        openModal(getCourseIdFromElement(target));
})

document.addEventListener("mouseover", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        const courseId = getCourseIdFromElement(event.target);
        const result = parseTime(courseData[courseId].time);
        result.forEach(period => {
            const block = document.getElementById(period);
            if (block.childElementCount)
                block.firstElementChild.classList.add("has-background-danger", "has-text-white");
            block.classList.add('has-background-info-light');
        })
    }
})

document.addEventListener("mouseout", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        document.querySelectorAll('.timetable .has-background-info-light')
            .forEach(elem => {
                elem.classList.remove('has-background-info-light');
                elem.firstElementChild?.classList.remove("has-background-danger", "has-text-white");
            });
    }
})

function openModal(courseId) {
    const modal = document.querySelector('.modal');
    modal.classList.add('is-active')

    const data = courseData[courseId];
    const fields = modal.querySelectorAll('dd');
    fields[0].textContent = data.id;
    fields[1].textContent = data.credit;
    fields[2].textContent = data.teacher;
    fields[3].textContent = data.time;
    fields[4].textContent = data.room;

    modal.querySelector('.card-header-title').textContent = data.name;
    // modal.querySelector('#outline').href = `https://timetable.nctu.edu.tw/?r=main/crsoutline&Acy=${YEAR}&Sem=${SEMESTER}&CrsNo=${courseId}&lang=zh-tw`;
    modal.querySelector('#outline').href = `https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/6/6.2/6.2.9/JH629001.php`;
}

function createTag(text, type) {
    const tag = document.createElement("span");
    tag.className = `tag is-rounded ${type}`;
    tag.textContent = text;
    return tag;
}

function appendCourseElement(course, search = false) {
    const template = document.importNode(document.getElementById("courseTemplate").content, true);
    if (course.type < 3) {
        template.getElementById("type").textContent = COURSE_TYPE[course.type];
        const typeColor = course.type === 0 ? 'is-white' :
            course.type === 1 ? 'is-danger' :
                'is-primary';
        template.getElementById("type").className = `tag is-rounded ${typeColor}`;
    }
    template.getElementById("name").textContent = course.name;

    if (course.english)
        template.querySelector(".chips").appendChild(createTag("英文授課", "is-success"));
/*     course.brief_code.forEach(code =>
        code in BERIEF_CODE &&
        template.querySelector(".chips").appendChild(createTag(BERIEF_CODE[code], "is-warning"))); */

    template.getElementById("detail").textContent = `${course.id}・${course.teacher}・${+course.credit} 學分`;
    template.querySelector(".course").dataset.id = course.id;
    template.querySelector(".toggle-course").classList.toggle('is-selected', course.id in selectedCourse)

    document.querySelector(search ? ".result" : ".selected").appendChild(template);
}

function search(searchTerm) {
    if (!searchTerm &&
        !(filter.department)
    ) return [];

    const regex = RegExp(searchTerm, 'i');
    const regex2 = RegExp(searchTerm.replace(/\ /g, ''), 'i');
    const result = Object.values(courseData)
        .filter(course => ((!filter.department || course.id.match(filter.departmentRegex)) && (
            course.id.match(regex) ||
            course.id.match(regex2) ||
            course.teacher.match(regex) ||
            course.name.match(regex)))
        ).slice(0, FIND_COURSE_RESULT_LIMIT);

    return result;
}

function save(remote = true) {
    const lastUpdate = +new Date();
    localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
    localStorage.setItem("lastUpdate", +new Date());

    if (firebase.auth().currentUser && remote)
        db.ref(`user/${firebase.auth().currentUser.uid}/${YEAR}${SEMESTER}`).set({
            course: selectedCourse,
            lastUpdate: lastUpdate
        });
}

function toggleCourse(courseId) {
    const button = document.querySelector(`.course[data-id="${courseId}"] .toggle-course`);
    if (courseId in selectedCourse) { // Remove course
        delete selectedCourse[courseId];

        document.querySelector(`.selected [data-id="${courseId}"]`).remove();
        document.querySelectorAll(`.period[data-id="${courseId}"]`).forEach(elem => elem.remove());
        button?.classList.remove('is-selected');
    } else { // Select course
        const periods = parseTime(courseData[courseId].time);
        const isConflict = periods.some(period => document.getElementById(period).childElementCount)
        if (isConflict) {
            Toast.fire({
                icon: 'error',
                title: "和目前課程衝堂了欸"
            });
            return;
        }
        selectedCourse[courseId] = true;
        appendCourseElement(courseData[courseId]);
        renderPeriodBlock(courseData[courseId]);
        button?.classList.add('is-selected');
    }
    save();
    document.querySelector(".credits").textContent = `${totalCredits()} 學分`;
}

function parseTime(timeCode) {
    const timeList = timeCode.match(/[MTWRFS][1-9nabc]/g);
    if (!timeList) return [];

    const result = timeList.map(
        code => [...code].map(char => `${code[0]}${char}`).slice(1)
    ).flat();

    return result;
}

function renderPeriodBlock(course) {
    const periods = parseTime(course.time);
    periods.forEach(period => document.getElementById(period).innerHTML = `
    <div data-id="${course.id}" class="period modal-launcher">
        <span>${course.name}</span>
    </div>`);
}

function renderSearchResult(searchTerm) {
    document.querySelector(".result").innerHTML = '';
    if (typeof searchTerm === 'undefined')
        searchTerm = document.querySelector(".input").value.trim();
    const result = search(searchTerm);
    result.forEach(course => appendCourseElement(course, true));
}

document.querySelector(".input").oninput = event => {
    const searchTerm = event.target.value.trim();
    if (searchTerm.includes("'"))
        document.querySelector(".result").textContent = "1064 - You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near ''' at line 1.";

    renderSearchResult(searchTerm);
}

document.getElementById("import").onclick = () => {
    Swal.fire({
        title: '匯入課表',
        text: "接下來將會覆蓋你目前的課表ㄛ，確定嗎？",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '匯入'
    }).then(result => {
        if (result.value) {
            save();
            Toast.fire({
                title: `<a href=${APP_URL}>匯入完成！點此前往選課模擬</a>`,
                icon: "success"
            });
        }
    })
}

function getShareKey() {
    const units_cnt = Object.keys(selectedCourse).reduce((a, b) => (a[b.replace(/[0-9]/g, "")] = a[b.replace(/[0-9]/g, "")] + 1 || 1, a), {});
    const units = Object.keys(units_cnt).reduce((a, b) => (a += `${(units_cnt[b] === 1 ? "" : units_cnt[b])}${b},`), "");
    const numbers = BigInt(Object.keys(selectedCourse).reduce((a, b) => (a += b.match(/\d+$/)[0], a), "")).toString(36);
    return units + numbers;
}

document.getElementById("copy-link").onclick = () => {
    const shareKey = getShareKey();

    const link = `${APP_URL}?share=${shareKey}`;
    const copy = document.createElement("div");
    copy.textContent = link;
    document.body.appendChild(copy);

    const textRange = document.createRange();
    textRange.selectNode(copy);
    const selet = window.getSelection();
    selet.removeAllRanges();
    selet.addRange(textRange);

    try {
        document.execCommand('copy');
        Toast.fire({
            title: `<a href="${link}" target="_blank">複製好了！點此可直接前往</a>`,
            icon: "success"
        });
    } catch (err) {
        console.log('Oops, unable to copy');
    }

    document.body.removeChild(copy);
}

document.getElementById("download").onclick = () => {
    const scale = 2;
    const domNode = document.getElementsByClassName("table-container")[0];
    domtoimage.toPng(domNode, {
        bgcolor: "#ffffff",
        width: domNode.scrollWidth * scale,
        height: domNode.scrollHeight * scale,
        style: {
            transform: 'scale('+scale+')',
            transformOrigin: 'top left'
        }
    }).then(function (dataUrl) {
        var link = document.createElement('a');
        link.download = '課程表.png';
        link.href = dataUrl;
        link.click();
    });
}

document.querySelector('.modal-background').onclick =
    document.querySelector('.card-header-icon').onclick =
    () => document.querySelector('.modal').classList.remove('is-active');

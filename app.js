const TIME_MAPPING = {
    "M": "6:00 ~ 6:50",
    "N": "7:00 ~ 7:50",
    "A": "8:00 ~ 8:50",
    "B": "9:00 ~ 9:50",
    "C": "10:10 ~ 11:00",
    "D": "11:10 ~ 12:00",
    "X": "12:20 ~ 13:10",
    "E": "13:20 ~ 14:10",
    "F": "14:20 ~ 15:10",
    "G": "15:30 ~ 16:20",
    "H": "16:30 ~ 17:20",
    "Y": "17:30 ~ 18:20",
    "I": "18:30 ~ 19:20",
    "J": "19:30 ~ 20:20",
    "K": "20:30 ~ 21:20",
    "L": "21:30 ~ 22:20"
}

const YEAR = '109', SEMESTER = '1';

let courseData = {};
let selectedCourse = {};

window.onload = () => {
    // Generate timetable.
    Object.keys(TIME_MAPPING).forEach(period => {
        const div = document.createElement("div");
        div.textContent = `${period} / ${TIME_MAPPING[period]}`;
        document.querySelector(".time-interval").appendChild(div);
    });

    Object.keys(TIME_MAPPING).forEach(period => {
        for (let day = 1; day <= 7; ++day) {
            const div = document.createElement("div");
            div.id = `${day}${period}`;
            document.querySelector('.content').appendChild(div);
        }
    });

    // Fetch course data.
    fetch(`course-data/${YEAR}${SEMESTER}-data.json`)
        .then(r => r.json())
        .then(data => {
            courseData = data;
            selectedCourse = JSON.parse(localStorage.getItem("selectedCourse")) || {};
            for (courseId in selectedCourse) {
                const course = selectedCourse[courseId] = courseData[courseId]; // Update data.
                renderPeriodBlock(course);
                appendCourseElement(course);
            }
        });
}

function getCourseIdFromElement(element) {
    return element.closest('.course,.period').id.split("-")[1];
}

document.addEventListener("click", function (event) {
    if (event.target.classList.contains('toggle-course'))
        toggleCourse(getCourseIdFromElement(event.target));

    if (event.target.classList.contains('modal-launcher'))
        toggleModal(getCourseIdFromElement(event.target));
})

document.addEventListener("mouseover", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        const courseId = getCourseIdFromElement(event.target);
        const result = parseTime(courseData[courseId].time);
        result.forEach(period => {
            const block = document.getElementById(period);
            if (block.childElementCount)
                block.firstElementChild.classList.add("has-background-danger", "has-text-white");
            block.classList.add('has-background-info-light')
        })
    }
})

document.addEventListener("mouseout", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        document.querySelectorAll('.timetable>.content>[class="has-background-info-light"]')
            .forEach(elem => {
                elem.className = '';
                elem.firstElementChild?.classList.remove("has-background-danger", "has-text-white");
            });
    }
})

function toggleModal(courseId) {
    const modal = document.querySelector('.modal');
    if (modal.classList.contains('is-active')) {
        modal.classList.remove('is-active');
        return;
    }

    modal.classList.add('is-active')
    const data = courseData[courseId];
    const fields = modal.querySelectorAll('dd');
    fields[0].textContent = data.id;
    fields[1].textContent = data.credit;
    fields[2].textContent = data.teacher;
    fields[3].textContent = data.time;

    modal.querySelector('.card-header-title').textContent = data.name;
    modal.querySelector('#outline').href = `https://timetable.nctu.edu.tw/?r=main/crsoutline&Acy=${YEAR}&Sem=${SEMESTER}&CrsNo=${courseId}&lang=zh-tw`;
}

function appendCourseElement(course, search = false) {
    const template = document.getElementById("courseTemplate");
    template.content.querySelector(".tag").textContent = course.id;
    template.content.getElementById("name").textContent = course.name;
    template.content.getElementById("detail").textContent = `${course.teacher}・${+course.credit} 學分`;
    template.content.querySelector(".course").id = `course-${course.id}`;

    template.content.querySelector("button").classList.toggle('is-danger', course.id in selectedCourse)
    template.content.querySelector("i").classList.toggle('fa-times', course.id in selectedCourse)

    const clone = document.importNode(template.content, true);
    document.querySelector(search ? ".result" : ".selected").appendChild(clone);
}

function search(searchTerm) {
    if (!searchTerm) return [];

    const regex = RegExp(searchTerm, 'i');
    const result = Object.values(courseData)
        .filter(course => (
            (course.id != searchTerm && course.id.match(regex)) ||
            course.teacher.match(regex) ||
            course.name.match(regex)
        ))
        .slice(0, 50);

    return result;
}

function toggleCourse(courseId) {
    const icon = document.querySelector(`#course-${courseId} .toggle-icon`);
    const button = document.querySelector(`#course-${courseId} button`);
    if (courseId in selectedCourse) { // Remove course
        delete selectedCourse[courseId];

        document.querySelector(`.selected #course-${courseId}`).remove();
        document.querySelectorAll(`#timetable-${courseId}`).forEach(elem => elem.remove());
        icon?.classList.replace('fa-times', 'fa-plus');
        button?.classList.remove('is-danger');
    } else { // Select course
        const periods = parseTime(courseData[courseId].time);
        const isConflict = periods.some(period => document.getElementById(period).childElementCount)
        if (isConflict) {
            alert('衝堂了欸')
            return;
        }

        selectedCourse[courseId] = courseData[courseId];

        appendCourseElement(courseData[courseId]);
        renderPeriodBlock(courseData[courseId]);
        icon?.classList.replace('fa-plus', 'fa-times');
        button?.classList.add('is-danger');
    }

    localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
}

function parseTime(timeCode) {
    const timeList = timeCode.match(/[1-7][A-Z]+/g);
    const result = timeList.map(
        code => [...code].map(char => `${code[0]}${char}`).slice(1)
    ).flat();

    return result;
}

function renderPeriodBlock(course) {
    const periods = parseTime(course.time);
    periods.forEach(period => document.getElementById(period).innerHTML = `
    <div id="timetable-${course.id}" class="period modal-launcher">
        <span>${course.name}</span>
    </div>`);
}

document.querySelector(".input").oninput = event => {
    document.querySelector(".result").innerHTML = '';
    const searchTerm = event.target.value.trim();
    const result = search(searchTerm);

    result.forEach(course => appendCourseElement(course, true));
}



document.querySelector('.modal-background').onclick =
    document.querySelector('.card-header-icon').onclick = toggleModal;
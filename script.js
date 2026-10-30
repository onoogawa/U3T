const boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");

// Supabase接続情報
const SUPABASE_URL = "https://muxbidgynhfqravewhsv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_SdvlZPT451wbewu5J9zs8w_Aze-AkJ5";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

const authForm = document.getElementById("auth-form");
const authUserPanel = document.getElementById("auth-user-panel");
const authUserInfo = document.getElementById("auth-user-info");
const authMessage = document.getElementById("auth-message");

function setAuthMessage(message) {
    authMessage.textContent = message;
}

function updateAuthUI(session) {
    if (session && session.user) {
        authForm.hidden = true;
        authUserPanel.hidden = false;

        authUserInfo.textContent =
            `ログイン中：${session.user.email}`;
    } else {
        authForm.hidden = false;
        authUserPanel.hidden = true;
    }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    updateAuthUI(session);

    if (event === "SIGNED_OUT") {
        setAuthMessage("ログアウトしました。");
    }
});

function setStatus(text, state = "normal") {
    statusElement.textContent = text;
    statusElement.className = `status-${state}`;
}

const boards = Array.from({ length: 9 }, () => 
    Array(9).fill("")
);
const initialPosition = boards.map(board => [...board]);

const winPatterns = [
    [0,1,2],
    [3,4,5],
    [6,7,8],
    [0,3,6],
    [1,4,7],
    [2,5,8],
    [0,4,8],
    [2,4,6]
];

const boardWinners = Array(9).fill("");

const moveHistory = [];

let currentPlayer = "O";
let nextBoard = null;
let gameOver = false;
let isReplayMode = false;
let replayIndex = null;

function createBoard() {
    boardElement.innerHTML = "";
    for (let i = 0; i < 9; i++) {
        const smallBoard = document.createElement("div");
        smallBoard.className = "small-board";
        smallBoard.dataset.boardNumber = i + 1;

        for (let j = 0; j < 9; j++) {
            const cell = document.createElement("button");
            cell.className = "cell";
            cell.textContent = boards[i][j];

            cell.dataset.board = i;
            cell.dataset.cell = j;

            cell.addEventListener("click", () => {
                handleClick(i, j, cell);
            });

            smallBoard.appendChild(cell);
        }

        boardElement.appendChild(smallBoard);
    }
}

function handleClick(boardIndex, cellIndex, cell) {
    if (isReplayMode) return;
    if (gameOver) return;

    if (nextBoard !== null && boardIndex !== nextBoard) {
        return;
    }
    
    if (!isBoardPlayable(boardIndex)) {
        return;
    }

    if (boards[boardIndex][cellIndex] !== "") {
        return;
    }

    boards[boardIndex][cellIndex] = currentPlayer;
    cell.textContent = currentPlayer;

    moveHistory.push({
        player: currentPlayer,
        board: boardIndex,
        cell: cellIndex,
        position: boards.map(board => [...board])
    });

    renderMoveHistory();

    const winner = checkWinner(boards[boardIndex]);

    if (winner !== "") {
        boardWinners[boardIndex] = winner;

        const smallBoard = boardElement.children[boardIndex];
        smallBoard.classList.add(`won-${winner.toLowerCase()}`);
    }

    const bigWinner = checkWinner(boardWinners);

    if (bigWinner !== "") {
        gameOver = true;
        nextBoard = null;
        updateBoardStyles();

        updateBoardStyles();
        setStatus(`${bigWinner}の勝利！`, "finished");
        return;
    }

    if (isBoardPlayable(cellIndex)) {
        nextBoard = cellIndex;
    } else {
        nextBoard = null;
    }

    const allBoardsFinished = boardWinners.every(
        (winner, i) => winner !== "" || isBoardFull(i)
    );

    if (allBoardsFinished) {
        gameOver = true;
        nextBoard = null;
        saveCurrentMoveState();
        updateBoardStyles();

        setStatus("引き分け！", "finished");
        return;
    }

    currentPlayer = currentPlayer === "X" ? "O" : "X";

    saveCurrentMoveState();

    updateBoardStyles();
    
    let statusText = "";

    if (winner !== "") {
        statusText = `${winner}が小盤面をget...!`;
    }

    statusText = statusText + `次の手番:${currentPlayer}`;

    if (nextBoard === null) {
        statusText = statusText + `(好きな小盤面)`;
    } else {
        statusText = statusText + `(${nextBoard + 1}番の小盤面)`;
    }

    setStatus(statusText, currentPlayer === "X" ? "x" : "o");
}

function saveCurrentMoveState() {
    const move = moveHistory[moveHistory.length - 1];

    if (!move) return;

    move.boardWinners = [...boardWinners];
    move.nextBoard = nextBoard;
    move.nextPlayer = currentPlayer;
    move.gameOver = gameOver;
}

function checkWinner(cells) {
    for (const pattern of winPatterns) {
        const [a,b,c] = pattern;

        if (cells[a] !== "" && cells[a] === cells[b] && cells[b] === cells[c]) {
            return cells[a];
        }
    }

    return "";
}

function isBoardFull(boardIndex) {
    return boards[boardIndex].every(cell => cell !== "");
}

function isBoardPlayable(boardIndex) {
    return (boardWinners[boardIndex] === "" && !isBoardFull(boardIndex));
}

function updateBoardStyles() {
    for (let i = 0; i < 9; i++) {
        const smallBoard = boardElement.children[i];

        smallBoard.classList.remove("active-board");

        if (nextBoard === null ? isBoardPlayable(i) : i === nextBoard && isBoardPlayable(i)) {
            smallBoard.classList.add("active-board");
        }
    }
}

function resetGame() {
    for (let i = 0; i < 9; i++) {
        boards[i].fill("");
        boardWinners[i] = "";
    }

    currentPlayer = "O";
    nextBoard = null;
    gameOver = false;
    moveHistory.length = 0;

    isReplayMode = false;
    replayIndex = null;
    document.getElementById("return-to-game-button").hidden = true;

    createBoard();
    updateBoardStyles();
    renderMoveHistory();
    updateReplayControls();
    setStatus("次の手番:O", "o");
}

function displayPosition(position, state = null) {
    for (let i = 0; i < 9; i++) {
        const smallBoard = boardElement.children[i];

        smallBoard.classList.remove("won-x", "won-o");
        smallBoard.classList.remove("active-board");

        for (let j = 0; j < 9; j++) {
            smallBoard.children[j].textContent = position[i][j];
        }

        const winner = checkWinner(position[i]);

        if (winner !== "") {
            smallBoard.classList.add(`won-${winner.toLowerCase()}`);
        }
    }

    if (state === null) return;

    const winners = state.boardWinners;

    if (!winners) return;

    const isPlayableInPosition = (i) => {
        const isFull = position[i].every(cell => cell !== "");

        return winners[i] === "" && !isFull;
    };

    for (let i = 0; i < 9; i++) {
        const isActive =
            state.nextBoard === null
                ? isPlayableInPosition(i)
                : state.nextBoard === i && isPlayableInPosition(i);

        if (isActive) {
            boardElement.children[i].classList.add("active-board");
        }
    }
}

function showReplayPosition(moveIndex) {
    if (moveIndex < -1 || moveIndex >= moveHistory.length) {
        return;
    }

    if (
        moveIndex >= 0 &&
        !moveHistory[moveIndex].position
    ) {
        return;
    }

    isReplayMode = true;
    replayIndex = moveIndex;

    if (moveIndex === -1) {
        displayPosition(initialPosition, {
            boardWinners: Array(9).fill(""),
            nextBoard: null
        });
        setStatus("対局開始時点を再生中", "replay");
    } else {
        const move = moveHistory[moveIndex];

        displayPosition(move.position, move);

        setStatus(`${moveIndex + 1}手目の局面を再生中（${move.player}の着手後）`, "replay");
    }

    document.getElementById("return-to-game-button").hidden = false;

    updateReplayControls();
    renderMoveHistory();
}

function updateReplayControls() {
    const previousButton =
        document.getElementById("previous-move-button");

    const nextButton =
        document.getElementById("next-move-button");

    previousButton.disabled =
        !isReplayMode || replayIndex <= -1;

    nextButton.disabled =
        !isReplayMode || replayIndex >= moveHistory.length - 1;
}

function showPreviousMove() {
    if (!isReplayMode) return;

    showReplayPosition(replayIndex - 1);
}

function showNextMove() {
    if (!isReplayMode) return;

    if (replayIndex < moveHistory.length - 1) {
        showReplayPosition(replayIndex + 1);
    }
}


function renderMoveHistory() {
    const moveList = document.getElementById("move-list");
    moveList.innerHTML = "";

    let selectedItem = null;

    moveHistory.forEach((move, index) => {
        const item = document.createElement("li");

        item.textContent =
            `${index + 1}手目：${move.player} ` +
            `${move.board + 1}-` +
            `${move.cell + 1}`;

        item.addEventListener("click", () => {
            showReplayPosition(index);
        });

        if (isReplayMode && index === replayIndex) {
            item.classList.add("current-move");
            selectedItem = item;
        }

        moveList.appendChild(item);
    });

    if (selectedItem) {
        const listRect = moveList.getBoundingClientRect();
        const itemRect = selectedItem.getBoundingClientRect();

        if (itemRect.top < listRect.top) {
            moveList.scrollTop -= listRect.top - itemRect.top;
        } else if (itemRect.bottom > listRect.bottom) {
            moveList.scrollTop += itemRect.bottom - listRect.bottom;
        }
    }
}

function returnToGame() {
    isReplayMode = false;
    replayIndex = null;
    renderMoveHistory();

    displayPosition(boards);
    updateBoardStyles();

    document.getElementById("return-to-game-button").hidden = true;

    updateReplayControls();

    if (gameOver) {
        const winner = checkWinner(boardWinners);

        if (winner !== "") {
            setStatus(`${winner}の勝利！`, "finished");
        } else {
            setStatus("引き分け！", "finished");
        }
    } else {
        let statusText = `次の手番:${currentPlayer}`;

        if (nextBoard === null) {
            statusText += "(好きな小盤面)";
        } else {
            statusText += `(${nextBoard + 1}番の小盤面)`;
        }

        setStatus(statusText, currentPlayer === "X" ? "x" : "o");
    }
}


createBoard();
updateBoardStyles();
setStatus("次の手番:O", "o");

document.getElementById("reset-button").addEventListener("click", resetGame);
document.getElementById("previous-move-button").addEventListener("click", showPreviousMove);
document.getElementById("next-move-button").addEventListener("click", showNextMove);
document.getElementById("return-to-game-button").addEventListener("click", returnToGame);

// 新規登録
async function signUpUser() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    if (!email || !password) {
        setAuthMessage("メールアドレスとパスワードを入力してください。");
        return;
    }

    if (password.length < 6) {
        setAuthMessage("パスワードは6文字以上にしてください。");
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            emailRedirectTo:
                window.location.origin + window.location.pathname
        }
    });

    if (error) {
        setAuthMessage("登録エラー：" + error.message);
        return;
    }

    if (data.session) {
        setAuthMessage("登録・ログインが完了しました。");
    } else {
        setAuthMessage(
            "確認メールを送信しました。メール内のリンクを開いてください。"
        );
    }
}

async function loginUser() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    if (!email || !password) {
        setAuthMessage("メールアドレスとパスワードを入力してください。");
        return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        setAuthMessage("ログインエラー：" + error.message);
        return;
    }

    setAuthMessage("ログインしました。");
}

async function logoutUser() {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        setAuthMessage("ログアウトエラー：" + error.message);
        return;
    }

    setAuthMessage("ログアウトしました。");
}

document.getElementById("signup-button")
    .addEventListener("click", signUpUser);

document.getElementById("login-button")
    .addEventListener("click", loginUser);

document.getElementById("logout-button")
    .addEventListener("click", logoutUser);
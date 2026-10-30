const boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");

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
        
        document.getElementById("saved-games-panel").hidden = false;
    } else {
        authForm.hidden = false;
        authUserPanel.hidden = true;
        document.getElementById("saved-games-panel").hidden = true;
        document.getElementById("saved-games-list").innerHTML = "";
    }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    currentOnlineUserId = session?.user?.id ?? null;
    updateAuthUI(session);

    if (event === "SIGNED_OUT") {
        setAuthMessage("ログアウトしました。");
    }

    if (
        session &&
        (event === "SIGNED_IN" || event === "INITIAL_SESSION")
    ) {
        window.setTimeout(() => {
            loadSavedGames();
            restoreOnlineRoom();
        }, 0);
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

const onlineSavingRoomIds = new Set();
const onlineSavedRoomIds = new Set();

let replayMoves = moveHistory;

let currentPlayer = "O";
let nextBoard = null;
let gameOver = false;
let isReplayMode = false;
let replayIndex = null;
let gameSaved = false;
let gameSaveInProgress = false;
let savedGamesLoadId = 0;
let activeOnlineRoom = null;
let activeRoomChannel = null;
let currentOnlineUserId = null;
let roomRestoreInProgress = false;
let rematchSwitchingRoomId = null;

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

    if (activeOnlineRoom) {
        if (activeOnlineRoom.status !== "playing") {
            setRoomMessage("相手の参加を待っています。");
            return;
        }

        submitOnlineMove(boardIndex, cellIndex);
        return;
    }

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

        saveCurrentMoveState();

        saveGameResult(bigWinner);

        updateBoardStyles();

        statusElement.textContent = `${bigWinner}の勝利！`;
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

        saveGameResult("draw");

        updateBoardStyles();

        statusElement.textContent = `引き分け！`;
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

async function saveGameResult(result) {
    if (gameSaved || gameSaveInProgress) return;

    gameSaveInProgress = true;
    setAuthMessage("対局記録を保存しています...");

    try {
        const { data, error: authError } =
            await supabaseClient.auth.getUser();

        if (authError) throw authError;

        const user = data.user;

        if (!user) {
            setAuthMessage(
                "対局は終了しました。保存するにはログインしてください。"
            );
            return;
        }

        const movesToSave = moveHistory.map(move => ({
            player: move.player,
            board: move.board,
            cell: move.cell,
            position: move.position,
            boardWinners: move.boardWinners,
            nextBoard: move.nextBoard,
            nextPlayer: move.nextPlayer,
            gameOver: move.gameOver
        }));

        const { error } = await supabaseClient
            .from("games")
            .insert({
                user_id: user.id,
                result: result,
                move_count: movesToSave.length,
                moves: movesToSave
            });

        if (error) throw error;

        gameSaved = true;
        setAuthMessage("対局結果と棋譜を保存しました！");

    } catch (error) {
        console.error("Game save error:", error);
        setAuthMessage("保存エラー：" + error.message);

    } finally {
        gameSaveInProgress = false;
    }
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
    if (activeOnlineRoom) {
        setRoomMessage(
            "オンラインルーム利用中はリセットできません。"
        );
        return;
    }

    for (let i = 0; i < 9; i++) {
        boards[i].fill("");
        boardWinners[i] = "";
    }

    currentPlayer = "O";
    nextBoard = null;
    gameOver = false;
    moveHistory.length = 0;
    gameSaved = false;
    gameSaveInProgress = false;

    isReplayMode = false;
    replayIndex = null;
    replayMoves = moveHistory;
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
    if (moveIndex < -1 || moveIndex >= replayMoves.length) {
        return;
    }

    if (
        moveIndex >= 0 &&
        !replayMoves[moveIndex].position
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
        const move = replayMoves[moveIndex];

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
        !isReplayMode || replayIndex >= replayMoves.length - 1;
}

function showPreviousMove() {
    if (!isReplayMode) return;

    showReplayPosition(replayIndex - 1);
}

function showNextMove() {
    if (!isReplayMode) return;

    if (replayIndex < replayMoves.length - 1) {
        showReplayPosition(replayIndex + 1);
    }
}


function renderMoveHistory() {
    const moveList = document.getElementById("move-list");
    moveList.innerHTML = "";

    let selectedItem = null;

    replayMoves.forEach((move, index) => {
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
    replayMoves = moveHistory;
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

    if (activeRoomChannel) {
        await supabaseClient.removeChannel(activeRoomChannel);
        activeRoomChannel = null;
    }

    activeOnlineRoom = null;

    localStorage.removeItem("activeOnlineRoomId");

    setAuthMessage("ログアウトしました。");
}

document.getElementById("signup-button")
    .addEventListener("click", signUpUser);

document.getElementById("login-button")
    .addEventListener("click", loginUser);

document.getElementById("logout-button")
    .addEventListener("click", logoutUser);

async function loadSavedGames() {
    const loadId = ++savedGamesLoadId;

    const message =
        document.getElementById("saved-games-message");

    const list =
        document.getElementById("saved-games-list");

    list.replaceChildren();
    message.textContent = "読み込み中...";

    try {
        const { data, error: authError } =
            await supabaseClient.auth.getUser();

        if (loadId !== savedGamesLoadId) return;

        if (authError || !data.user) {
            message.textContent = "ログインしてください。";
            return;
        }

        const { data: games, error } = await supabaseClient
            .from("games")
            .select("id, created_at, result, move_count, moves")
            .order("created_at", { ascending: false })
            .limit(50);

        if (loadId !== savedGamesLoadId) return;

        if (error) throw error;

        if (!games || games.length === 0) {
            message.textContent = "保存された対局はありません。";
            return;
        }

        const fragment = document.createDocumentFragment();

        games.forEach(game => {
            const item = document.createElement("li");
            const button = document.createElement("button");

            const date = new Date(game.created_at)
                .toLocaleString("ja-JP");

            const resultText =
                game.result === "X" ? "Xの勝利" :
                game.result === "O" ? "Oの勝利" :
                "引き分け";

            button.textContent =
                `${date} | ${resultText} | ${game.move_count}手`;

            button.addEventListener("click", () => {
                loadSavedGame(game);
            });

            item.appendChild(button);
            fragment.appendChild(item);
        });

        list.replaceChildren(fragment);

        message.textContent =
            `${games.length}件の対局が見つかりました。`;

    } catch (error) {
        if (loadId !== savedGamesLoadId) return;

        console.error("Saved games loading error:", error);
        message.textContent =
            "対局一覧の取得に失敗しました：" + error.message;
    }
}

function loadSavedGame(game) {
    if (!Array.isArray(game.moves) || game.moves.length === 0) {
        alert("この対局には棋譜がありません。");
        return;
    }

    const validMoves = game.moves.every(move =>
        move &&
        Array.isArray(move.position) &&
        move.position.length === 9 &&
        move.position.every(board =>
            Array.isArray(board) && board.length === 9
        )
    );

    if (!validMoves) {
        alert("この対局の棋譜データが不完全です。");
        return;
    }

    replayMoves = game.moves;

    showReplayPosition(replayMoves.length - 1);

    document.getElementById("saved-games-message").textContent =
        `${new Date(game.created_at).toLocaleString("ja-JP")} の対局を再生中`;
}

loadSavedGames();

function setRoomMessage(message) {
    document.getElementById("room-message").textContent = message;
}

function displayOnlineRoom(room) {

    if (room.status === "cancelled") {
        activeOnlineRoom = null;
        const rematchButton =
            document.getElementById("rematch-room-button");

        if (rematchButton) {
            rematchButton.hidden = true;
            rematchButton.disabled = false;
        }

        localStorage.removeItem("activeOnlineRoomId");

        document.getElementById("active-room-panel").hidden = true;

        document.getElementById("room-create-area").hidden = false;
        document.getElementById("room-join-area").hidden = false;

        document.getElementById("active-room-code").textContent = "";
        document.getElementById("room-status-display").textContent =
            "このルームは解散されています。";

        return;
    }

    activeOnlineRoom = room;

    if (
        room.status === "waiting" ||
        room.status === "playing"
    ) {
        localStorage.setItem(
            "activeOnlineRoomId",
            room.id
        );
    } else {
        localStorage.removeItem("activeOnlineRoomId");
    }

    const panel =
        document.getElementById("active-room-panel");

    panel.hidden = false;

    document.getElementById("active-room-code").textContent =
        room.room_code;

    const statusText =
        room.status === "waiting"
            ? "相手の参加を待っています。"
            : room.status === "playing"
                ? "対戦相手が参加しました。"
                : room.status === "finished"
                    ? "対局終了"
                    : "ルーム状態：" + room.status;

    document.getElementById("room-status-display").textContent =
        statusText;

    const rematchButton =
    document.getElementById("rematch-room-button");

    if (rematchButton) {
        const alreadyRequested =
            Array.isArray(room.rematch_requested_by) &&
            room.rematch_requested_by.includes(currentOnlineUserId);

        rematchButton.hidden = room.status !== "finished";
        rematchButton.disabled = alreadyRequested;

        rematchButton.textContent = alreadyRequested
            ? "再戦希望済み"
            : "再戦する";
    }
}

function applyOnlineRoomState(room) {
    if (!room || !room.state) return;

    if (
        room.status !== "playing" &&
        room.status !== "finished"
    ) {
        return;
    }

    const state = room.state;

    if (
        !Array.isArray(state.boards) ||
        state.boards.length !== 9 ||
        !Array.isArray(state.boardWinners) ||
        state.boardWinners.length !== 9
    ) {
        console.error("不正なオンライン盤面データ", room);
        return;
    }

    for (let i = 0; i < 9; i++) {
        if (
            !Array.isArray(state.boards[i]) ||
            state.boards[i].length !== 9
        ) {
            console.error("小盤面のデータが不正です。");
            return;
        }

        boards[i].splice(
            0,
            boards[i].length,
            ...state.boards[i]
        );

        boardWinners[i] = state.boardWinners[i];
    }

    currentPlayer = state.currentPlayer;

    nextBoard =
        state.nextBoard === null
            ? null
            : Number(state.nextBoard);

    gameOver = Boolean(state.gameOver);

    moveHistory.splice(
        0,
        moveHistory.length,
        ...(Array.isArray(room.moves) ? room.moves : [])
    );

    replayMoves = moveHistory;

    isReplayMode = false;
    replayIndex = null;

    document.getElementById("return-to-game-button").hidden = true;

    displayPosition(boards, {
        boardWinners: boardWinners,
        nextBoard: nextBoard
    });

    updateBoardStyles();
    renderMoveHistory();
    updateReplayControls();

    if (gameOver) {
        setStatus(
            room.winner === "draw"
                ? "引き分け！"
                : `${room.winner}の勝利！`,
            "finished"
        );
    } else {
        let myMark = null;

        if (currentOnlineUserId === room.host_id) {
            myMark = "O";
        } else if (currentOnlineUserId === room.guest_id) {
            myMark = "X";
        }

        if (myMark === null) {
            console.error("プレイヤー判定に失敗しました", {
                currentOnlineUserId,
                hostId: room.host_id,
                guestId: room.guest_id
            });

            setRoomMessage(
                "ユーザー情報を確認できません。再接続してください。"
            );

            return;
        }

        const turnText =
            currentPlayer === myMark
                ? "あなたの手番"
                : "相手の手番";

        const targetText =
            nextBoard === null
                ? "好きな小盤面"
                : `${nextBoard + 1}番の小盤面`;

        setStatus(
            `オンライン対戦：${turnText}（あなたは${myMark}）。次は${targetText}`,
            currentPlayer === "O" ? "o" : "x"
        );
    }
}

async function submitOnlineMove(boardIndex, cellIndex) {
    if (!activeOnlineRoom) return;

    if (activeOnlineRoom.status !== "playing") {
        setRoomMessage("現在対局中ではありません。");
        return;
    }

    setRoomMessage("着手を送信しています...");

    const { data, error } = await supabaseClient.rpc(
        "make_room_move",
        {
            p_room_id: activeOnlineRoom.id,
            p_board_index: boardIndex,
            p_cell_index: cellIndex
        }
    );

    if (error) {
        console.error("Online move error:", error);

        setRoomMessage(
            "着手できませんでした：" + error.message
        );
        return;
    }

    displayOnlineRoom(data);
    applyOnlineRoomState(data);

    if (data.status === "finished") {
        await saveFinishedOnlineRoom(data.id);
    } else {
        setRoomMessage("着手が反映されました。");
    }
}

async function subscribeToOnlineRoom(room) {

    if (activeRoomChannel) {
        await supabaseClient.removeChannel(activeRoomChannel);
        activeRoomChannel = null;
    }

    const roomId = room.id;

    const channel = supabaseClient
        .channel(`room-updates-${roomId}`)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "rooms",
                filter: `id=eq.${roomId}`
            },
            async (payload) => {
                const updatedRoom = payload.new;
                if (
                    activeOnlineRoom &&
                    updatedRoom.id === activeOnlineRoom.id &&
                    updatedRoom.rematch_room_id
                ) {
                    setRoomMessage(
                    "相手も再戦を希望しました。新しい対局へ移動します..."
                    );

                    await switchToRematchRoom(
                    updatedRoom.rematch_room_id
                    );

                    return;
                }

                if (
                    !activeOnlineRoom ||
                    updatedRoom.id !== activeOnlineRoom.id
                ) {
                    return;
                }

                const previousStatus = activeOnlineRoom.status;

                const previousMoveCount =
                Array.isArray(activeOnlineRoom.moves)
                    ? activeOnlineRoom.moves.length
                    : 0;

                const updatedMoveCount =
                Array.isArray(updatedRoom.moves)
                    ? updatedRoom.moves.length
                    : 0;

                console.log("ルーム更新を受信:", updatedRoom);

                displayOnlineRoom(updatedRoom);

                if (updatedRoom.status === "cancelled") {
                    setRoomMessage(
                        "ホストがルームを解散しました。"
                    );

                    return;
                }

                if (
                    updatedRoom.status === "playing" ||
                    updatedRoom.status === "finished"
                ) {
                    applyOnlineRoomState(updatedRoom);
                }

                if (updatedRoom.status === "finished") {
                    setRoomMessage("対局が終了しました。");
                    saveFinishedOnlineRoom(updatedRoom.id);
                }
                else if (
                    previousStatus === "waiting" &&
                    updatedRoom.status === "playing"
                ) {
                    setRoomMessage(
                    "相手が参加しました！対局を開始できます。"
                    );
                }
                else if (
                    updatedRoom.status === "playing" &&
                    updatedMoveCount > previousMoveCount
                ) {
                    setRoomMessage("新しい着手を受信しました。");
                }
            }
        )
        .subscribe((status, error) => {

            console.log("Realtime status:", status);

            if (status === "SUBSCRIBED") {
                setRoomMessage(
                    "ルームの自動更新が有効になりました。"
                );
            }

            if (
                status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT"
            ) {
                console.error("Realtime error:", error);

                setRoomMessage(
                    "リアルタイム接続に失敗しました。手動更新を利用してください。"
                );
            }
        });

    activeRoomChannel = channel;
}

async function createOnlineRoom() {
    const button =
        document.getElementById("create-room-button");

    if (button.disabled) return;

    button.disabled = true;

    try {
        setRoomMessage("ログイン状態を確認しています...");

        const { data, error: sessionError } =
            await supabaseClient.auth.getSession();

        if (sessionError) {
            throw sessionError;
        }

        const session = data.session;

        if (!session || !session.user) {
            setRoomMessage(
                "ルームを作成するにはログインしてください。"
            );
            return;
        }

        currentOnlineUserId = session.user.id;

        setRoomMessage("ルームを作成しています...");

        const { data: room, error } =
            await supabaseClient.rpc("create_room");

        if (error) {
            throw error;
        }

        if (!room || !room.id) {
            throw new Error("ルーム情報を取得できませんでした。");
        }

        displayOnlineRoom(room);

        await subscribeToOnlineRoom(room);

        setRoomMessage(
            "ルームを作成しました。相手にコードを共有してください。"
        );

    } catch (error) {
        console.error("Room creation error:", error);

        setRoomMessage(
            "ルーム作成エラー：" + error.message
        );

    } finally {
        button.disabled = false;
    }
}

async function joinOnlineRoom() {
    const input =
        document.getElementById("room-code-input");

    const roomCode = input.value.trim().toUpperCase();

    if (!roomCode) {
        setRoomMessage("参加コードを入力してください。");
        return;
    }

    if (!/^[A-F0-9]{8}$/.test(roomCode)) {
        setRoomMessage("8桁の英数字コードを入力してください。");
        return;
    }

    const { data: userData, error: authError } =
        await supabaseClient.auth.getUser();

    currentOnlineUserId = userData.user.id;

    if (authError || !userData.user) {
        setRoomMessage("参加するにはログインしてください。");
        return;
    }

    setRoomMessage("ルームに参加しています...");

    const { data, error } =
        await supabaseClient.rpc("join_room", {
            p_room_code: roomCode
        });

    if (error) {
        console.error(error);
        setRoomMessage("参加エラー：" + error.message);
        return;
    }

    displayOnlineRoom(data);

    if (
        data.status === "playing" ||
        data.status === "finished"
    ) {
        applyOnlineRoomState(data);
    }

    await subscribeToOnlineRoom(data);
}

async function refreshOnlineRoom() {
    if (!activeOnlineRoom) return;

    const { data, error } = await supabaseClient
        .from("rooms")
        .select("*")
        .eq("id", activeOnlineRoom.id)
        .single();

    if (error) {
        console.error(error);
        setRoomMessage("ルーム情報の取得に失敗しました。");
        return;
    }

    displayOnlineRoom(data);

    if (
        data.status === "playing" ||
        data.status === "finished"
    ) {
        applyOnlineRoomState(data);
    }

    if (data.status === "finished") {
        await saveFinishedOnlineRoom(data.id);
    }

    setRoomMessage("ルーム情報を更新しました。");
}

async function restoreOnlineRoom() {
    if (roomRestoreInProgress) return;

    roomRestoreInProgress = true;

    try {
        const roomId = localStorage.getItem("activeOnlineRoomId");

        if (!roomId) return;

        const { data: userData, error: authError } =
            await supabaseClient.auth.getUser();

        if (authError || !userData.user) return;

        currentOnlineUserId = userData.user.id;

        const { data: room, error } = await supabaseClient
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!room) {
            localStorage.removeItem("activeOnlineRoomId");
            setRoomMessage("保存されたルームが見つかりません。");
            return;
        }

        if (
            room.host_id !== userData.user.id &&
            room.guest_id !== userData.user.id
        ) {
            localStorage.removeItem("activeOnlineRoomId");
            setRoomMessage("このルームにはアクセスできません。");
            return;
        }

        if (room.status === "cancelled") {
            displayOnlineRoom(room);

            setRoomMessage(
                "このルームは解散されています。"
            );

            return;
        }

        displayOnlineRoom(room);

        if (
            room.status === "playing" ||
            room.status === "finished"
        ) {
            applyOnlineRoomState(room);
        }

        await subscribeToOnlineRoom(room);

        setRoomMessage(
            room.status === "waiting"
                ? "待機中のルームに再接続しました。"
                : room.status === "playing"
                    ? "対局に再接続しました。"
                    : "終了した対局を復元しました。"
        );

    } catch (error) {
        console.error("Room restore error:", error);

        setRoomMessage(
            "ルームの復元に失敗しました：" + error.message
        );

    } finally {
        roomRestoreInProgress = false;
    }
}

async function leaveOnlineRoom() {
    if (!activeOnlineRoom) {
        setRoomMessage("退出できるルームがありません。");
        return;
    }

    if (!window.confirm("このルームから退出しますか？")) {
        return;
    }

    const roomId = activeOnlineRoom.id;

    try {
        setRoomMessage("ルームから退出しています...");

        const { data: room, error } =
            await supabaseClient.rpc("leave_room", {
                p_room_id: roomId
            });

        if (error) {
            throw error;
        }

        if (activeRoomChannel) {
            await supabaseClient.removeChannel(activeRoomChannel);
            activeRoomChannel = null;
        }

        activeOnlineRoom = null;
        localStorage.removeItem("activeOnlineRoomId");

        document.getElementById("active-room-panel").hidden = true;
        document.getElementById("room-create-area").hidden = false;
        document.getElementById("room-join-area").hidden = false;
        document.getElementById("room-status-display").textContent = "";

        if (room.status === "finished") {
            await saveFinishedOnlineRoom(room.id);
            applyOnlineRoomState(room);
        }

        setRoomMessage("ルームから退出しました。");

    } catch (error) {
        console.error("Room leave error:", error);

        setRoomMessage(
            "退出エラー：" + error.message
        );
    }
}

async function copyRoomCode() {
    if (!activeOnlineRoom) return;

    try {
        await navigator.clipboard.writeText(
            activeOnlineRoom.room_code
        );

        setRoomMessage("参加コードをコピーしました。");
    } catch (error) {
        setRoomMessage(
            "コピーできませんでした。コードを手動でコピーしてください。"
        );
    }
}

async function saveFinishedOnlineRoom(roomId) {
    if (!roomId) return;

    if (
        onlineSavedRoomIds.has(roomId) ||
        onlineSavingRoomIds.has(roomId)
    ) {
        return;
    }

    onlineSavingRoomIds.add(roomId);

    try {
        setRoomMessage("対局結果を保存しています...");

        const { data, error } = await supabaseClient.rpc(
            "save_finished_room",
            {
                p_room_id: roomId
            }
        );

        if (error) {
            throw error;
        }

        onlineSavedRoomIds.add(roomId);

        console.log("オンライン対局の保存件数:", data);

        await loadSavedGames();

        setRoomMessage(
            "対局結果と棋譜を保存しました！"
        );

    } catch (error) {
        console.error("Online game save error:", error);

        setRoomMessage(
            "対局は終了しましたが、保存に失敗しました：" +
            error.message
        );

    } finally {
        onlineSavingRoomIds.delete(roomId);
    }
}

async function switchToRematchRoom(roomId) {
    if (!roomId) return;

    if (
        activeOnlineRoom?.id === roomId ||
        rematchSwitchingRoomId === roomId
    ) {
        return;
    }

    if (rematchSwitchingRoomId !== null) return;

    rematchSwitchingRoomId = roomId;

    try {
        const { data: room, error } = await supabaseClient
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .maybeSingle();

        if (error) throw error;

        if (!room) {
            throw new Error("再戦ルームが見つかりません。");
        }

        displayOnlineRoom(room);
        applyOnlineRoomState(room);

        await subscribeToOnlineRoom(room);

        setRoomMessage("再戦を開始しました！");

    } catch (error) {
        console.error("Rematch switch error:", error);

        setRoomMessage(
            "再戦ルームへの移動に失敗しました：" + error.message
        );

    } finally {
        rematchSwitchingRoomId = null;
    }
}

async function requestOnlineRematch() {
    if (
        !activeOnlineRoom ||
        activeOnlineRoom.status !== "finished"
    ) {
        setRoomMessage("再戦できる対局がありません。");
        return;
    }

    const roomId = activeOnlineRoom.id;

    const button =
        document.getElementById("rematch-room-button");

    button.disabled = true;

    try {
        setRoomMessage("再戦希望を送信しています...");

        const { data, error } = await supabaseClient.rpc(
            "request_room_rematch",
            {
                p_room_id: roomId
            }
        );

        if (error) throw error;

        if (data.status === "waiting") {
            displayOnlineRoom(data.room);

            setRoomMessage(
                "再戦希望を送信しました。相手の返答を待っています。"
            );

        } else if (
            data.status === "created" &&
            data.room?.id
        ) {
            await switchToRematchRoom(data.room.id);

        } else {
            throw new Error("予期しない再戦結果です。");
        }

    } catch (error) {
        console.error("Rematch request error:", error);

        button.disabled = false;

        setRoomMessage(
            "再戦エラー：" + error.message
        );
    }
}

document.getElementById("create-room-button")
    .addEventListener("click", createOnlineRoom);

document.getElementById("join-room-button")
    .addEventListener("click", joinOnlineRoom);

document.getElementById("refresh-room-button")
    .addEventListener("click", refreshOnlineRoom);

document.getElementById("copy-room-code-button")
    .addEventListener("click", copyRoomCode);

document
    .getElementById("leave-room-button")
    .addEventListener("click", leaveOnlineRoom);

document
    .getElementById("rematch-room-button")
    .addEventListener("click", requestOnlineRematch);